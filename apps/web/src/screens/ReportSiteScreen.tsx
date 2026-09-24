import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Loader2,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { ReportCategory, ReportSeverity, ReportSubmissionPayload } from '@suraksha/shared';
import { REPORT_CATEGORIES, REPORT_SEVERITIES } from '@suraksha/shared';
import { Shield } from '@/components/Shield';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { InfoNote, SectionHeader } from '@/components/StatusPieces';
import { ApiRequestError, apiFetch, checkHealth } from '@/services/api';
import { formatDateTime } from '@/lib/format';
import { toast } from 'sonner';

/**
 * The public reporting website (`/report-site`).
 *
 * Served by the same origin and the same backend as the app, which is what makes
 * the 30-second fallback safe: the details arrive pre-filled (or are fetched by
 * id), and the report keeps its original `clientReportId`, so the server
 * deduplicates if both channels deliver.
 *
 * This page also works as a standalone reporting form for anyone without the app
 * — useful for travellers who never installed it.
 */
export function ReportSiteScreen() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);

  const [handoff, setHandoff] = useState<{
    payload?: ReportSubmissionPayload;
    note: string;
    tone: 'info' | 'success' | 'warning';
  }>({ note: 'Checking for details carried across from the SURAKSHA app…', tone: 'info' });
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    category: 'harassment' as ReportCategory,
    severity: 'medium' as ReportSeverity,
    title: '',
    description: '',
    occurredAt: new Date(Date.now() - 10 * 60_000).toISOString().slice(0, 16),
    locationLabel: '',
    reporterName: '',
    reporterContact: '',
    anonymity: 'named' as 'named' | 'anonymous',
  });
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ reference?: string; clientReportId: string; duplicate: boolean; receivedAt: string } | undefined>();

  const [trackRef, setTrackRef] = useState(params.get('ref') ?? '');
  const [tracking, setTracking] = useState(false);
  const [trackResult, setTrackResult] = useState<{ status: string; receivedAt: string; verification: string; note?: string } | undefined>();
  const [trackError, setTrackError] = useState<string | undefined>();
  const [serverNote, setServerNote] = useState<string | undefined>();

  useEffect(() => {
    void (async () => {
      const health = await checkHealth(4000);
      setServerNote(health.reachable ? health.message : `Reporting server not reachable: ${health.message}`);

      const encoded = params.get('d');
      const id = params.get('id');
      const handoffKey = params.get('handoff');

      // 1. Details carried in the URL (works cross-origin too).
      if (encoded) {
        try {
          const { decodePayload } = await import('@/services/reports');
          const payload = decodePayload(encoded);
          applyPayload(payload, 'Details were carried across from the SURAKSHA app — check them, then submit.');
          setLoading(false);
          return;
        } catch {
          setHandoff({ note: 'The carried details could not be decoded. Please re-enter the report.', tone: 'warning' });
        }
      }

      // 2. Details parked in this origin's storage by the app.
      if (handoffKey) {
        try {
          const raw = localStorage.getItem(`suraksha.report.handoff.${handoffKey}`);
          if (raw) {
            const parsed = JSON.parse(raw) as { payload: ReportSubmissionPayload };
            applyPayload(parsed.payload, 'Details were carried across from the SURAKSHA app on this device.');
          } else {
            setHandoff({
              note: 'No carried details were found in this browser (they may have been cleared). Re-enter the report below.',
              tone: 'warning',
            });
          }
        } catch {
          setHandoff({ note: 'Carried details could not be read. Please re-enter the report.', tone: 'warning' });
        }
        setLoading(false);
        return;
      }

      // 3. Ask the server for the report by id (it may already exist).
      if (id) {
        try {
          const data = await apiFetch<{ report: ReportSubmissionPayload & { status: string } }>(
            `/reports/${encodeURIComponent(id)}`,
            { timeoutMs: 8000 },
          );
          applyPayload(data.report, 'These details were loaded from the reporting server.');
        } catch {
          setHandoff({
            note: 'That report is not on the server. If it was queued on a device, submit it from the app or fill this form in.',
            tone: 'info',
          });
        }
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPayload = (payload: ReportSubmissionPayload, note: string) => {
    setHandoff({ payload, note, tone: 'success' });
    setForm({
      category: payload.category,
      severity: payload.severity,
      title: payload.title,
      description: payload.description,
      occurredAt: new Date(payload.occurredAt).toISOString().slice(0, 16),
      locationLabel: payload.locationLabel ?? '',
      reporterName: payload.reporterName ?? '',
      reporterContact: '',
      anonymity: payload.anonymity,
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);

    if (form.title.trim().length < 4) {
      setError('Give the report a short, recognisable title.');
      return;
    }
    if (form.description.trim().length < 15) {
      setError('Describe what happened so a reviewer can act on it.');
      return;
    }

    setSubmitting(true);
    const clientReportId = handoff.payload?.clientReportId ?? `web-${crypto.randomUUID()}`;

    const body: ReportSubmissionPayload = {
      clientReportId,
      category: form.category,
      severity: form.severity,
      title: form.title.trim(),
      description: form.description.trim(),
      occurredAt: new Date(form.occurredAt).toISOString(),
      anonymity: form.anonymity,
      reporterName: form.anonymity === 'named' ? form.reporterName || undefined : undefined,
      reporterContact: form.anonymity === 'named' ? form.reporterContact || undefined : undefined,
      location: handoff.payload?.location,
      locationLabel: form.locationLabel || undefined,
      journeyId: handoff.payload?.journeyId,
      attachments: handoff.payload?.attachments,
      riskScore: handoff.payload?.riskScore,
      source: 'website',
    };

    try {
      const ack = await apiFetch<{ serverAckId: string; reportId: string; receivedAt: string; duplicate: boolean }>(
        '/reports',
        { method: 'POST', body, timeoutMs: 30_000 },
      );

      setResult({
        reference: params.get('ref') ?? undefined,
        clientReportId,
        duplicate: ack.duplicate,
        receivedAt: ack.receivedAt ?? new Date().toISOString(),
      });
      setTrackRef(params.get('ref') ?? '');
      toast.success(ack.duplicate ? 'Already received — nothing duplicated.' : 'Report received by the reporting server.');
    } catch (caught) {
      const message =
        caught instanceof ApiRequestError
          ? caught.offline
            ? 'No connection to the reporting server. Check your internet connection and try again — do not close this page.'
            : caught.message
          : 'The report could not be submitted.';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const track = async () => {
    const reference = trackRef.trim();
    if (!reference) {
      setTrackError('Enter the tracking reference, for example SRK-4F9A21.');
      return;
    }
    setTracking(true);
    setTrackError(undefined);
    setTrackResult(undefined);
    try {
      const data = await apiFetch<{ status: string; receivedAt: string; verification: string; note?: string }>(
        `/reports/track/${encodeURIComponent(reference)}`,
        { timeoutMs: 9000 },
      );
      setTrackResult(data);
    } catch (caught) {
      setTrackError(
        caught instanceof ApiRequestError && caught.status === 404
          ? 'No report found with that reference. Check the characters — I and O are never used.'
          : 'Could not look that reference up right now. Try again in a moment.',
      );
    } finally {
      setTracking(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background pb-12">
      <header className="border-b border-border/70 bg-navy-900 px-5 py-6 text-white safe-top">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Shield className="size-9" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.22em] text-teal-300">SURAKSHA reporting</p>
            <h1 className="text-lg font-bold">Incident reporting website</h1>
          </div>
          <Badge variant="outline" className="border-white/30 text-white">
            <Globe aria-hidden />
            shared backend
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-5 pt-5">
        {serverNote ? (
          <InfoNote tone={serverNote.startsWith('Reporting server not') ? 'warning' : 'muted'}>
            <p>{serverNote}</p>
          </InfoNote>
        ) : null}

        {loading ? (
          <InfoNote tone="info">
            <p className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking for details carried from the app…
            </p>
          </InfoNote>
        ) : (
          <InfoNote tone={handoff.tone} title={handoff.payload ? 'Details carried across' : 'Reporting a new incident'}>
            <p>{handoff.note}</p>
            {handoff.payload ? (
              <p className="mt-1">
                Unique report ID preserved:{' '}
                <code className="rounded bg-muted px-1 font-mono text-[10px]">{handoff.payload.clientReportId}</code> —
                this is what prevents a duplicate if the app also delivers its queued copy.
              </p>
            ) : null}
          </InfoNote>
        )}

        {result ? (
          <Card className="border-emerald-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
                {result.duplicate ? 'Already received' : 'Report received'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {result.duplicate
                  ? 'This report had already reached us from the app. Nothing was duplicated.'
                  : 'The reporting server accepted your report and gave it a server-side acknowledgement.'}
              </p>
              <p className="text-xs text-muted-foreground">
                Received {formatDateTime(result.receivedAt)}. Keep the tracking reference below to follow it up.
              </p>
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                clientReportId: {result.clientReportId}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResult(undefined);
                  setHandoff({ note: 'You can file another report below.', tone: 'info' });
                  setForm((prev) => ({ ...prev, title: '', description: '' }));
                }}
              >
                File another report
              </Button>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4 text-teal-500" aria-hidden />
                  Report details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormError message={error} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Category" htmlFor="site-category" required>
                    <Select
                      id="site-category"
                      value={form.category}
                      onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as ReportCategory }))}
                      options={REPORT_CATEGORIES.map((item) => ({ value: item.value, label: item.label }))}
                    />
                  </Field>
                  <Field
                    label="Severity"
                    htmlFor="site-severity"
                    required
                    hint={REPORT_SEVERITIES.find((item) => item.value === form.severity)?.hint}
                  >
                    <Select
                      id="site-severity"
                      value={form.severity}
                      onChange={(event) => setForm((prev) => ({ ...prev, severity: event.target.value as ReportSeverity }))}
                      options={REPORT_SEVERITIES.map((item) => ({ value: item.value, label: item.label }))}
                    />
                  </Field>
                </div>

                <Field label="Title" htmlFor="site-title" required>
                  <Input
                    id="site-title"
                    value={form.title}
                    onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Followed from the station exit"
                    maxLength={120}
                  />
                </Field>

                <Field label="Description" htmlFor="site-description" required>
                  <Textarea
                    id="site-description"
                    value={form.description}
                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="min-h-[160px]"
                    placeholder="What happened, where, and anything that would help others or responders."
                    maxLength={4000}
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="When did it happen?" htmlFor="site-when" required>
                    <Input
                      id="site-when"
                      type="datetime-local"
                      value={form.occurredAt}
                      onChange={(event) => setForm((prev) => ({ ...prev, occurredAt: event.target.value }))}
                    />
                  </Field>
                  <Field label="Place (free text)" htmlFor="site-place">
                    <Input
                      id="site-place"
                      value={form.locationLabel}
                      onChange={(event) => setForm((prev) => ({ ...prev, locationLabel: event.target.value }))}
                      placeholder="Near the bus stop, opposite the mall"
                    />
                  </Field>
                </div>

                {handoff.payload?.location ? (
                  <InfoNote tone="info" title="Position attached">
                    <p>
                      The app attached a position to this report:{' '}
                      {handoff.payload.location.lat.toFixed(5)}, {handoff.payload.location.lng.toFixed(5)}
                      {handoff.payload.location.accuracy ? ` (±${Math.round(handoff.payload.location.accuracy)} m)` : ''}.
                    </p>
                  </InfoNote>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Your name (optional)" htmlFor="site-name" hint="Shared with responders only.">
                    <Input
                      id="site-name"
                      value={form.reporterName}
                      onChange={(event) => setForm((prev) => ({ ...prev, reporterName: event.target.value }))}
                      disabled={form.anonymity === 'anonymous'}
                    />
                  </Field>
                  <Field label="Contact (optional)" htmlFor="site-contact" hint="Only if you want a follow-up.">
                    <Input
                      id="site-contact"
                      value={form.reporterContact}
                      onChange={(event) => setForm((prev) => ({ ...prev, reporterContact: event.target.value }))}
                      disabled={form.anonymity === 'anonymous'}
                    />
                  </Field>
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={form.anonymity === 'anonymous'}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, anonymity: event.target.checked ? 'anonymous' : 'named' }))
                    }
                  />
                  <span>
                    Report anonymously
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      Your name and contact details are withheld from responders and never published.
                    </span>
                  </span>
                </label>

                {form.description.length > 0 && form.description.trim().length < 15 ? (
                  <FormError message="A little more detail helps — aim for a full sentence." />
                ) : null}
              </CardContent>
            </Card>

            <Button type="submit" variant="accent" size="lg" full loading={submitting} loadingText="Submitting…">
              <Send className="size-4" />
              Submit report
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Submissions go to the same reporting backend as the app, with the same unique report ID. If you are in
              immediate danger, call your local emergency number first.
            </p>
          </form>
        )}

        <SectionHeader title="Track a report" description="Use the reference printed when you submitted." />
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div className="flex gap-2">
              <Input
                aria-label="Tracking reference"
                value={trackRef}
                onChange={(event) => setTrackRef(event.target.value)}
                placeholder="SRK-4F9A21"
              />
              <Button variant="outline" loading={tracking} onClick={() => void track()}>
                <Search className="size-4" />
                Track
              </Button>
            </div>

            {trackError ? <FormError message={trackError} /> : null}

            {trackResult ? (
              <div className="space-y-2 rounded-xl border border-border bg-card/60 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-500" aria-hidden />
                  <span className="font-semibold">{trackResult.status}</span>
                  <Badge variant="outline" className="ml-auto">
                    <Clock aria-hidden />
                    {formatDateTime(trackResult.receivedAt)}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  Verification: {trackResult.verification}
                  {trackResult.note ? ` — ${trackResult.note}` : ''}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-100">
            SURAKSHA is a safety aid, not an emergency service. Reports are reviewed by responders when they are on
            shift. For anything urgent, call your emergency number. Risk values on this site are heuristic
            indicators produced by devices, not probabilities.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ReportSiteScreen;
