/**
 * The Google Maps debug surface — "did my key actually arrive?".
 *
 * Three entry points, all reading the same `getGoogleMapsStatus()` snapshot, so
 * they can never disagree with each other or with the console:
 *
 *   - `MapsKeyBadge`      → the pill in the corner of every map
 *   - `GoogleMapsDebugPanel` → the expandable detail (map popover + pages)
 *   - `surakshaMaps`      → the same object in the console (see `main.tsx`)
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  Satellite,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Chip, Input } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import type { Tone } from '@/lib/status';
import { GOOGLE_MAPS_KEY_VAR, maskKey } from '@/config/googleMaps';
import {
  formatGoogleMapsStatus,
  loadGoogleMapsApi,
  setSessionMapsKey,
  type GoogleMapsStatus,
} from '@/services/googleMapsApi';
import { readSavedBasemapPreference, resolveBasemap, type BasemapChoice } from '@/services/basemapPreference';
import { useBasemapPreference, useGoogleMapsStatus, useMapSurface } from './useGoogleMaps';

const VERDICT_TONE: Record<GoogleMapsStatus['verdict'], Tone> = {
  ready: 'safe',
  loading: 'brand',
  failed: 'alert',
  'not-loaded': 'safe',
  'needs-key': 'watch',
};

const VERDICT_LABEL: Record<GoogleMapsStatus['verdict'], string> = {
  ready: 'Live map ready',
  loading: 'Loading Maps API',
  failed: 'Map could not load',
  'not-loaded': 'Key found, live map off',
  'needs-key': 'No key set',
};

export function verdictIcon(verdict: GoogleMapsStatus['verdict'], size = 13) {
  if (verdict === 'ready') return <CircleCheck size={size} />;
  if (verdict === 'loading') return <Loader2 size={size} className="animate-spin" />;
  if (verdict === 'failed') return <TriangleAlert size={size} />;
  return <KeyRound size={size} />;
}

/* ------------------------------------------------------------------ */
/* Pill                                                                */
/* ------------------------------------------------------------------ */

/**
 * The always-visible one-liner on the map itself. Deliberately readable at a
 * glance: green means the tiles are real, amber means "your key never got here".
 */
export function MapsKeyBadge({
  open,
  onToggle,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { status, badgeLabel: label, badgeShort: short, tone } = useMapSurface();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={`Google Maps: ${status.summary}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-white/95 px-2.5 py-1 text-[11.5px] font-semibold shadow-sm backdrop-blur transition-state hover:bg-white',
        tone === 'safe'
          ? 'border-safe-200 text-safe-700'
          : tone === 'alert'
            ? 'border-alert-200 text-alert-700'
            : tone === 'brand'
              ? 'border-brand-200 text-brand-700'
              : 'border-watch-200 text-watch-800',
        className,
      )}
    >
      {verdictIcon(status.verdict)}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{short}</span>
      <span className="sr-only">Open the Google Maps key check</span>
    </button>
  );
}

/**
 * The non-interactive twin of the badge, for a `CardHeader` action slot: the
 * map should never be the only place that says whether you are looking at real
 * streets.
 */
export function MapSourceChip({ className, long = true }: { className?: string; long?: boolean }) {
  const { status, headerLabel, tone, live } = useMapSurface();
  return (
    <Chip tone={tone} className={className}>
      {live ? <Satellite size={12} /> : <Layers size={12} />}
      {long ? headerLabel : headerLabel.split(' · ')[0]}
      <span className="sr-only">{status.summary}</span>
    </Chip>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      <span className="min-w-0 text-right text-[12.5px] font-medium text-ink-700">{children}</span>
    </div>
  );
}

export function GoogleMapsDebugPanel({ compact = false }: { compact?: boolean }) {
  const status = useGoogleMapsStatus();
  const { choice, choose } = useBasemapPreference();
  const [testState, setTestState] = useState<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [copied, setCopied] = useState(false);
  const saved = readSavedBasemapPreference();
  const resolved = resolveBasemap(choice, status.configured);
  const tone = VERDICT_TONE[status.verdict];

  useEffect(() => {
    if (testState === 'idle') return;
    const timer = setTimeout(() => setTestState('idle'), 6000);
    return () => clearTimeout(timer);
  }, [testState]);

  const runTest = useCallback(async () => {
    setTestState('running');
    setTestMessage(null);
    try {
      await loadGoogleMapsApi();
      setTestState('ok');
      setTestMessage('Maps JS API loaded. Tiles should be rendering on the map.');
    } catch (cause) {
      setTestState('error');
      setTestMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const copyStatus = useCallback(async () => {
    const text = formatGoogleMapsStatus(status);
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setTestMessage('Clipboard blocked — the readout is printed in the console instead.');
      if (typeof console !== 'undefined') console.log(text);
    }
  }, [status]);

  const applyDraftKey = () => {
    const value = draftKey.trim();
    if (!value) return;
    setSessionMapsKey(value);
    setDraftKey('');
    void runTest();
  };

  return (
    <div
      data-testid="suraksha-maps-debug-panel"
      data-suraksha-maps-debug="true"
      className={cn('space-y-3', compact ? '' : 'text-[13px]')}
    >
      <div
        className={cn(
          'rounded-xl border px-3 py-2.5',
          tone === 'safe'
            ? 'border-safe-200 bg-safe-50 text-safe-800'
            : tone === 'alert'
              ? 'border-alert-200 bg-alert-50 text-alert-800'
              : tone === 'brand'
                ? 'border-brand-200 bg-brand-50 text-brand-800'
                : 'border-watch-200 bg-watch-50 text-watch-800',
        )}
      >
        <p className="flex items-start gap-2 text-[13px] font-bold">
          <span className="mt-0.5 shrink-0">{verdictIcon(status.verdict, 15)}</span>
          <span>{VERDICT_LABEL[status.verdict]}</span>
        </p>
        <p className="mt-1 text-[12.5px] font-medium leading-snug opacity-90">{status.summary}</p>
      </div>

      <div className="divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white px-3 py-1">
        <Row label="key">
          {status.configured ? (
            <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[12px] font-semibold text-ink-800">{status.keyMasked}</code>
          ) : (
            <span className="font-semibold text-watch-800">not set</span>
          )}
        </Row>
        <Row label="found in">
          {status.resolution.source === 'env'
            ? `.env → ${status.envName ?? GOOGLE_MAPS_KEY_VAR}`
            : status.resolution.source === 'session'
              ? 'this tab (sessionStorage)'
              : status.resolution.source === 'window'
                ? 'window global'
                : `looked for ${status.resolution.lookedFor.join(', ')}`}
        </Row>
        <Row label="shape">
          {status.configured
            ? `${status.keyLength} chars · ${status.inspection.looksLikeGoogleKey ? "starts with 'AIza'" : 'unexpected prefix'}`
            : '—'}
        </Row>
        <Row label="maps js api">
          <span className="inline-flex items-center gap-1.5">
            <Layers size={12} className="text-ink-400" />
            {status.loader.state}
            {status.loader.state === 'ready' && status.loader.durationMs !== null ? ` · ${status.loader.durationMs}ms` : ''}
            {status.loader.authFailure ? ' · refused by Google' : ''}
          </span>
        </Row>
        <Row label="map id">
          {status.mapId ?? <span className="text-ink-400">— (raster tiles, optional)</span>}
        </Row>
        <Row label="basemap">
          <span className="inline-flex items-center gap-1.5">
            <Satellite size={12} className="text-ink-400" />
            {resolved.basemap === 'live' ? 'Live Google tiles' : 'Simulated canvas'} · {choice}
            {choice === saved ? '' : ' (URL override)'}
          </span>
        </Row>
        <Row label="why">{resolved.reason}</Row>
        <Row label="vite vars seen">
          {status.envVarsSeen.length ? (
            <code className="text-[11.5px] text-ink-600">{status.envVarsSeen.join(', ')}</code>
          ) : (
            <span className="font-semibold text-alert-700">none — Vite injected no VITE_* variables</span>
          )}
        </Row>
        <Row label="build">
          {status.mode}
          {status.offline ? ' · offline' : ''}
        </Row>
      </div>

      {status.inspection.warnings.length ? (
        <ul className="space-y-1 rounded-xl border border-watch-200 bg-watch-50 px-3 py-2 text-[12px] font-medium text-watch-800">
          {status.inspection.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <CircleAlert size={13} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {status.fix.length ? (
        <ol className="space-y-1 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5">
          <li className="mb-1 text-[11.5px] font-bold uppercase tracking-wide text-ink-500">To switch it on</li>
          {status.fix.map((step, index) => (
            <li key={step} className="flex gap-2 text-[12.5px] leading-snug text-ink-700">
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink-900 text-[10px] font-bold text-white">
                {index + 1}
              </span>
              <span>
                {index === 0 ? (
                  <>
                    Put <code className="rounded bg-white px-1 py-0.5 text-[11.5px] font-semibold">{GOOGLE_MAPS_KEY_VAR}="AIza…"</code>{' '}
                    in <code className="rounded bg-white px-1 py-0.5 text-[11.5px] font-semibold">.env</code> at the repo root.
                  </>
                ) : (
                  step
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(['sim', 'live'] as BasemapChoice[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            aria-pressed={resolved.basemap === option}
            title={
              option === 'live'
                ? 'Real Google tiles, with the simulated route projected on top'
                : 'The offline canvas SURAKSHA falls back to — kept here for demos and debugging'
            }
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-state',
              resolved.basemap === option
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-ink-200 text-ink-600 hover:bg-ink-50',
            )}
          >
            {option === 'live' ? <Satellite size={13} /> : <Layers size={13} />}
            {option === 'live' ? 'Switch to live tiles' : 'Force the simulated fallback'}
          </button>
        ))}
        {choice !== 'auto' ? (
          <button
            type="button"
            onClick={() => choose('auto')}
            className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-ink-500 transition-state hover:bg-ink-50"
          >
            Follow the key (auto)
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" icon={testState === 'running' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} onClick={runTest}>
          {testState === 'running' ? 'Testing…' : 'Test connection'}
        </Button>
        <Button size="sm" variant="ghost" icon={copied ? <CircleCheck size={14} /> : <Copy size={14} />} onClick={copyStatus}>
          {copied ? 'Copied' : 'Copy readout'}
        </Button>
      </div>

      {testMessage ? (
        <p
          className={cn(
            'rounded-lg border px-2.5 py-2 text-[12px] font-medium',
            testState === 'error'
              ? 'border-alert-200 bg-alert-50 text-alert-800'
              : testState === 'ok'
                ? 'border-safe-200 bg-safe-50 text-safe-800'
                : 'border-ink-200 bg-ink-50 text-ink-600',
          )}
          role="status"
        >
          {testMessage}
        </p>
      ) : null}

      <div className="rounded-xl border border-ink-200 bg-ink-50/70 px-3 py-2.5">
        <p className="text-[12px] font-semibold text-ink-700">No .env yet? Paste a key for this tab only</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
          Stored in sessionStorage, so it disappears with the tab and is never written to SURAKSHA's saved state. A
          session key overrides <code className="rounded bg-white px-1 text-[11px] font-semibold">.env</code>.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            placeholder={status.configured ? `replace ${maskKey(status.resolution.value)}` : 'AIza…'}
            aria-label="Google Maps API key for this tab"
            className="h-9 min-w-[180px] flex-1 text-[12.5px]"
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
          <Button size="sm" onClick={applyDraftKey} disabled={draftKey.trim().length === 0}>
            Use
          </Button>
          {status.resolution.source === 'session' ? (
            <Button size="sm" variant="ghost" onClick={() => setSessionMapsKey(null)}>
              Clear override
            </Button>
          ) : null}
        </div>
      </div>

      <p className="flex items-start gap-2 text-[11.5px] leading-snug text-ink-500">
        <Terminal size={13} className="mt-0.5 shrink-0 text-ink-400" />
        <span>
          Console: <code className="rounded bg-ink-100 px-1 py-0.5 text-[11px] font-semibold">surakshaMaps.check()</code>{' '}
          · CLI:{' '}
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[11px] font-semibold">npm run maps:check</code>
        </span>
      </p>
    </div>
  );
}

/** Page-level wrapper (Profile, Guardian settings, the demo panel). */
export function GoogleMapsDebugCard({ className }: { className?: string }) {
  const status = useGoogleMapsStatus();
  return (
    <Card className={className}>
      <CardHeader
        title="Live map (Google Maps)"
        subtitle="Key check, basemap choice and the reason the map looks the way it does."
        icon={<Satellite size={16} />}
        action={
          <Chip tone={VERDICT_TONE[status.verdict]}>
            {verdictIcon(status.verdict, 12)}
            {status.configured ? status.keyMasked : 'no key'}
          </Chip>
        }
      />
      <CardBody>
        <GoogleMapsDebugPanel />
      </CardBody>
    </Card>
  );
}
