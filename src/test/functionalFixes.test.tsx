import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { store } from '@/store/hooks';
import { SurakshaStore } from '@/store/store';
import { backend } from '@/services/backend';
import { presentEvent } from '@/services/eventBus';
import { evidenceStorage } from '@/services/evidenceStorage';
import { createEvidenceRecord, readEvidenceFile, validateEvidenceFile, MAX_EVIDENCE_BYTES } from '@/services/evidence';
import { GuardianDashboard } from '@/pages/guardian/GuardianDashboard';
import { GuardianAlerts } from '@/pages/guardian/GuardianAlerts';
import { IncidentDetail } from '@/pages/traveller/IncidentDetail';
import { ExitModePage } from '@/pages/traveller/ExitModePage';
import { ExitModeOverlay } from '@/components/domain/ExitMode';
import { EventTimeline } from '@/components/domain/EventTimeline';
import { reduceJourney, journeyToRiskInputs } from '@/domain/journeyMachine';
import { estimatedArrivalAt } from '@/domain/journey';
import { RISK_WEIGHTS, bandForScore } from '@/domain/riskEngine';

function renderPage(page: React.ReactNode) { return render(<MemoryRouter>{page}</MemoryRouter>); }
function tick(count = 1) {
  for (let i = 0; i < count; i++) (store as unknown as { tick(): void }).tick();
}
async function record() {
  const buffer = new TextEncoder().encode('Evidence content').buffer;
  const metadata = await createEvidenceRecord({ fileName: 'statement.txt', mimeType: 'text/plain', buffer,
    kind: 'note', description: 'Test attachment', at: store.getState().now });
  return { buffer, metadata };
}
function reload() {
  const fresh = new SurakshaStore(); fresh.hydrate(); fresh.stop(); return fresh;
}

beforeEach(async () => {
  window.localStorage.clear();
  store.hydrate(); store.stop(); store.resetDemo(); store.setRole('traveller');
  await evidenceStorage.clear();
});
afterEach(() => { store.stop(); vi.useRealTimers(); });

describe('Fake Call help and microphone isolation', () => {
  it('opens and dismisses setup help using Escape', async () => {
    renderPage(<ExitModePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Fake call help' }));
    expect(screen.getByRole('dialog', { name: 'How to use Fake Call' })).toBeTruthy();
    expect(screen.getByText(/Choose a caller and delay/)).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps speech and call timers running while muted and while help is open', () => {
    vi.useFakeTimers();
    const speak = vi.fn(); const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel, resume: vi.fn() });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    store.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' });
    store.answerExitCall();
    const view = renderPage(<ExitModeOverlay />);
    expect(speak).toHaveBeenCalledTimes(1);
    const cancelled = cancel.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fake call help' }));
    expect(cancel).toHaveBeenCalledTimes(cancelled);
    act(() => vi.advanceTimersByTime(4100));
    expect(speak).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(store.getState().exitMode?.answered).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(speak).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
    expect(cancel.mock.calls.length).toBeGreaterThan(cancelled);
    act(() => { store.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' }); store.answerExitCall(); });
    expect(screen.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe('false');
    view.unmount(); vi.unstubAllGlobals();
  });
});

describe('Late-arrival calculation', () => {
  it('uses the expected deadline even while the detour ETA keeps moving', () => {
    store.startCanonicalJourney(); store.moveOffRoute();
    const j = store.getState().journey!;
    const overdue = j.expectedArrivalAt + 1;
    expect(estimatedArrivalAt(j, overdue)).toBeGreaterThan(overdue);
    expect(journeyToRiskInputs(j, j.expectedArrivalAt).pastExpectedArrival).toBe(false);
    const assessed = reduceJourney(j, { type: 'TICK' }, overdue);
    expect(assessed.lateMinutes).toBeGreaterThan(0);
    expect(assessed.risk.reasons.find((r) => r.code === 'late_arrival')?.delta).toBe(RISK_WEIGHTS.lateArrival);
    expect(assessed.risk.score).toBeGreaterThan(j.risk.score);
    expect(assessed.risk.band).toBe(bandForScore(assessed.risk.score));
  });

  it('does not let an earlier safe check-in hide a newly overdue arrival', () => {
    store.startCanonicalJourney(); store.confirmSafe('journey');
    const j = store.getState().journey!;
    const next = reduceJourney({ ...j, lastPositionAt: j.expectedArrivalAt + 1 }, { type: 'TICK' }, j.expectedArrivalAt + 1);
    expect(next.risk.band).toBe('WATCH'); expect(next.risk.score).toBe(30);
    const confirmed = reduceJourney(next, { type: 'SAFE_CONFIRMED' }, j.expectedArrivalAt + 60_000);
    expect(confirmed.risk.score).toBeLessThan(next.risk.score);
  });

  it('updates both risk views without remounting and records arrival delay on completion', () => {
    store.startCanonicalJourney();
    renderPage(<GuardianDashboard />);
    act(() => store.simulateEtaSlip(31));
    expect(store.getState().journey!.risk.reasons.some((r) => r.code === 'late_arrival')).toBe(true);
    expect(screen.getAllByText(/late|past.*arrival/i).length).toBeGreaterThan(0);
    const changed = store.getState().events.find((e) => e.type === 'risk_changed')!;
    expect(presentEvent(changed).label).toContain('(score 30)');
    const lateEvents = store.getState().events.filter((e) => e.type === 'late_arrival');
    expect(lateEvents).toHaveLength(1);
    act(() => tick(3));
    expect(store.getState().events.filter((e) => e.type === 'late_arrival')).toHaveLength(1);
    act(() => store.endJourney('arrived'));
    const ended = store.getState().journey!;
    expect(ended.arrivedAt).toBe(ended.endedAt);
    expect(ended.lateMinutes).toBeGreaterThan(0);
    expect(ended.risk.score).toBe(0);
    expect(reduceJourney(ended, { type: 'TICK' }, ended.endedAt! + 600_000).risk.score).toBe(0);
  });
});

describe('Guardian alert read state', () => {
  it('changes read badges immediately, keeps acknowledgement separate, and survives reload', async () => {
    store.startCanonicalJourney(); store.moveOffRoute(); store.setRole('guardian');
    renderPage(<GuardianAlerts />);
    expect(screen.getByText('1 unread')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(screen.getByText('0 unread')).toBeTruthy(); expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ACKNOWLEDGE' })).toBeTruthy();
    const fresh = reload();
    expect(fresh.getState().alerts.every((a) => a.read)).toBe(true);
    expect(fresh.getState().alerts[0].acknowledgedAt).toBeNull();
  });

  it('only marks the current guardian’s alerts, and reports durable-write failures', () => {
    store.startCanonicalJourney(); store.moveOffRoute(); store.setRole('guardian');
    const own = store.getState().alerts[0];
    backend.saveAlerts([own, { ...own, id: 'foreign', guardianId: 'another-guardian' }]);
    // Simulate the backend receiving another guardian's record before hydration.
    window.localStorage.removeItem('suraksha.v1.session');
    const scoped = reload(); scoped.markAlertsRead();
    expect(scoped.getState().alerts.find((a) => a.id === own.id)?.read).toBe(true);
    expect(scoped.getState().alerts.find((a) => a.id === 'foreign')?.read).toBe(false);
    vi.spyOn(backend, 'saveAlerts').mockImplementation(() => { throw new Error('Disk full'); });
    scoped.markAlertsRead();
    expect(scoped.getState().toasts.some((t) => t.title === 'Could not mark alerts read')).toBe(true);
  });
});

describe('Evidence end-to-end local persistence', () => {
  it('attaches to the viewed historical incident, not the unrelated active incident, and persists bytes', async () => {
    store.startCanonicalJourney(); const active = store.triggerSos('quick_sos')!;
    const historical = store.getState().incidents.find((i) => i.id !== active.id)!;
    const { buffer, metadata } = await record();
    await store.saveEvidence(historical.id, metadata, buffer);
    expect(store.getState().incidents.find((i) => i.id === active.id)!.evidence).toHaveLength(0);
    expect(store.getState().events.find((e) => e.type === 'evidence_attached')?.journeyId).toBe(historical.journeyId);
    const fresh = reload();
    const blob = await fresh.readEvidence(historical.id, metadata.id);
    expect(blob.size).toBe(buffer.byteLength);
    const original = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsText(blob); });
    expect(original).toBe('Evidence content');
    await fresh.removeEvidence(metadata.id, historical.id);
    await expect(fresh.readEvidence(historical.id, metadata.id)).rejects.toThrow(/original file/);
  });

  it('uploads through the existing file input and displays a persistent download action', async () => {
    const id = store.getState().incidents[0].id;
    render(<MemoryRouter initialEntries={[`/incidents/${id}`]}><Routes>
      <Route path="/incidents/:incidentId" element={<IncidentDetail role="traveller" />} />
    </Routes></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText('Attach evidence file'), new File(['user statement'], 'proof.txt', { type: 'text/plain' }));
    await waitFor(() => expect(screen.getByText('Evidence attached and saved on this device.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Download proof.txt' })).toBeTruthy();
    const persisted = reload().getState().incidents.find((i) => i.id === id)!.evidence[0];
    expect(persisted.blobId).toBeTruthy(); expect(persisted.simulated).toBe(false);
  });

  it('rejects unsupported/oversized/empty files and surfaces UI errors', async () => {
    expect(() => validateEvidenceFile({ name: 'x.svg', type: 'image/svg+xml', size: 100 })).toThrow(/Unsupported/);
    expect(() => validateEvidenceFile({ name: 'x.pdf', type: 'application/pdf', size: MAX_EVIDENCE_BYTES + 1 })).toThrow(/10 MB/);
    await expect(readEvidenceFile(new File([], 'empty.txt', { type: 'text/plain' }))).rejects.toThrow(/empty/);
    const id = store.getState().incidents[0].id;
    render(<MemoryRouter initialEntries={[`/incidents/${id}`]}><Routes>
      <Route path="/incidents/:incidentId" element={<IncidentDetail role="traveller" />} />
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Attach evidence file'), { target: { files: [new File([], 'empty.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(store.getState().incidents[0].evidence).toHaveLength(0);
  });

  it('rolls back blobs when metadata cannot persist and forbids guardian writes/unrelated reads', async () => {
    const id = store.getState().incidents[0].id;
    const { buffer, metadata } = await record();
    const save = vi.spyOn(backend, 'saveIncidents').mockImplementation(() => { throw new Error('Quota exceeded'); });
    await expect(store.saveEvidence(id, metadata, buffer)).rejects.toThrow(/Quota/);
    await expect(evidenceStorage.get(metadata.id)).rejects.toThrow(/not available/);
    expect(store.getState().incidents[0].evidence).toHaveLength(0);
    save.mockRestore();
    await store.saveEvidence(id, metadata, buffer);
    store.setRole('guardian');
    await expect(store.readEvidence(id, metadata.id)).resolves.toBeTruthy();
    await expect(store.saveEvidence(id, metadata, buffer)).rejects.toThrow(/permission/);
    store.updateGuardianProfile({ id: 'foreign', contactId: 'foreign-contact' });
    await expect(store.readEvidence(id, metadata.id)).rejects.toThrow(/permission/);
  });
});

describe('Guardian check-in synchronization', () => {
  it('automatically shows the latest status/timestamp and persists one completion without adding alerts/incidents', () => {
    store.startCanonicalJourney();
    const alerts = store.getState().alerts.length, incidents = store.getState().incidents.length;
    renderPage(<GuardianDashboard />);
    act(() => { store.confirmSafe('journey'); store.confirmSafe('journey'); });
    expect(screen.getByText('Traveller confirmed safe')).toBeTruthy();
    expect(screen.getByText(/Last confirmed:/)).toBeTruthy();
    expect(store.getState().journey!.checkIn.completedCount).toBe(1);
    expect(store.getState().events.filter((e) => e.type === 'checkin_completed')).toHaveLength(1);
    expect(store.getState().alerts).toHaveLength(alerts); expect(store.getState().incidents).toHaveLength(incidents);
    expect(reload().getState().journey!.checkIn.lastCompletedAt).toBe(store.getState().now);
  });

  it('does not show another guardian’s check-in and coalesces the paired audit events', () => {
    store.startCanonicalJourney(); store.confirmSafe('journey');
    const { events, now } = store.getState();
    const timeline = render(<EventTimeline events={events} now={now} />);
    expect(screen.getAllByText('Check-in completed — traveller confirmed safe')).toHaveLength(1);
    expect(screen.queryByText('Safety confirmed by traveller')).toBeNull(); timeline.unmount();
    store.updateGuardianProfile({ id: 'foreign', contactId: 'foreign-contact' });
    renderPage(<GuardianDashboard />);
    expect(screen.queryByText('Traveller confirmed safe')).toBeNull();
  });

  it('consumes committed cross-tab updates without changing that tab’s role', () => {
    store.startCanonicalJourney();
    const guardian = reload(); guardian.setRole('guardian'); guardian.start();
    store.confirmSafe('journey');
    window.dispatchEvent(new StorageEvent('storage', { key: 'suraksha.v1.session', storageArea: window.localStorage }));
    expect(guardian.getState().journey!.checkIn.lastCompletedAt).toBe(store.getState().now);
    expect(guardian.getState().role).toBe('guardian');
    expect(guardian.getState().events.filter((e) => e.type === 'checkin_completed')).toHaveLength(1);
    guardian.stop();
  });
});
