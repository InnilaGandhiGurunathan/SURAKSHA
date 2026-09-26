/**
 * Google Maps JS API: config status, script loader and the debug surface.
 *
 * The loader is written by hand instead of pulling in `@react-google-maps/api`
 * or `@vis.gl/react-google-maps`: one script tag plus one promise is the whole
 * job, it keeps the offline demo dependency-free, and it means the map still
 * renders (as the simulated SVG) when the key is absent or the network refuses.
 *
 * Every failure mode a developer can hit here is *named* in
 * `getGoogleMapsStatus()` so the UI can show it instead of rendering a blank
 * grey box and leaving you to guess.
 */

import {
  GOOGLE_MAPS_KEY_VAR,
  GOOGLE_MAPS_SCRIPT,
  SESSION_ID_SLOT,
  SESSION_KEY_SLOT,
  buildFixSteps,
  describeSource,
  inspectGoogleMapsKey,
  maskKey,
  resolveGoogleMapsId,
  resolveGoogleMapsKey,
  writeSessionValue,
  type KeyInspection,
  type KeyResolution,
} from '@/config/googleMaps';
import { appMode, envVarNames, isDevBuild } from '@/config/env';
import { resolveBasemap } from '@/services/basemapPreference';

/* ------------------------------------------------------------------ */
/* The slice of the Maps API this app touches                          */
/* ------------------------------------------------------------------ */

export interface GoogleMapsLatLng {
  lat: number;
  lng: number;
}

export interface GoogleMapsMapOptions {
  center?: GoogleMapsLatLng;
  zoom?: number;
  /** Optional: only needed for vector maps / AdvancedMarkerElement. */
  mapId?: string;
  disableDefaultUI?: boolean;
  clickableIcons?: boolean;
  gestureHandling?: 'cooperative' | 'greedy' | 'none';
  zoomControl?: boolean;
  mapTypeControl?: boolean;
  streetViewControl?: boolean;
  fullscreenControl?: boolean;
  backgroundColor?: string;
  isFractionalZoomEnabled?: boolean;
}

export interface GoogleMapsMap {
  setOptions(options: GoogleMapsMapOptions): void;
  setCenter(center: GoogleMapsLatLng): void;
  panTo(center: GoogleMapsLatLng): void;
  setZoom(zoom: number): void;
  getZoom(): number;
  fitBounds(bounds: GoogleMapsBounds, padding?: number | Record<string, number>): void;
  resize?: () => void;
}

export interface GoogleMapsBounds {
  extend(point: GoogleMapsLatLng): void;
}

export interface GoogleMapsMarkerOptions {
  map?: GoogleMapsMap | null;
  position?: GoogleMapsLatLng;
  title?: string;
  label?: string | { text: string; color?: string; className?: string; fontSize?: string; fontWeight?: string };
  icon?: Record<string, unknown> | string;
  zIndex?: number;
  clickable?: boolean;
}

export interface GoogleMapsMarker {
  setMap(map: GoogleMapsMap | null): void;
  setPosition(position: GoogleMapsLatLng | null): void;
  setOptions(options: GoogleMapsMarkerOptions): void;
}

export interface GoogleMapsPathOptions {
  map?: GoogleMapsMap | null;
  path?: GoogleMapsLatLng[];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  fillColor?: string;
  fillOpacity?: number;
  zIndex?: number;
  clickable?: boolean;
  visible?: boolean;
  icons?: Array<{ icon: Record<string, unknown>; offset?: string; repeat?: string }>;
}

export interface GoogleMapsPath {
  setMap(map: GoogleMapsMap | null): void;
  setOptions(options: GoogleMapsPathOptions): void;
  setPath(path: GoogleMapsLatLng[]): void;
}

export interface GoogleMapsApi {
  Map: new (element: HTMLElement, options?: GoogleMapsMapOptions) => GoogleMapsMap;
  Marker: new (options?: GoogleMapsMarkerOptions) => GoogleMapsMarker;
  Polyline: new (options?: GoogleMapsPathOptions) => GoogleMapsPath;
  Polygon: new (options?: GoogleMapsPathOptions) => GoogleMapsPath;
  LatLngBounds: new (southwest?: GoogleMapsLatLng, northeast?: GoogleMapsLatLng) => GoogleMapsBounds;
  SymbolPath: { CIRCLE?: unknown; FORWARD_CLOSED_ARROW?: unknown };
  event: {
    addListener(target: object, eventName: string, handler: (...args: unknown[]) => void): { remove(): void };
  };
  importLibrary?: (name: string) => Promise<unknown>;
  version?: string;
}

interface GoogleWindow {
  google?: { maps?: GoogleMapsApi };
  gm_authFailure?: () => void;
  __SURAKSHA_MAPS_CALLBACK__?: () => void;
}

function asGoogleWindow(): GoogleWindow {
  if (typeof window === 'undefined') return {};
  return window as unknown as GoogleWindow;
}

/** Present when the script already ran (hot reload, a second map, a host page). */
export function peekGoogleMapsApi(): GoogleMapsApi | null {
  return asGoogleWindow().google?.maps ?? null;
}

/* ------------------------------------------------------------------ */
/* Loader state                                                        */
/* ------------------------------------------------------------------ */

export type LoaderState = 'idle' | 'loading' | 'ready' | 'error';

export interface LoaderSnapshot {
  state: LoaderState;
  error: string | null;
  /** The key the current/last attempt used, masked. */
  keyMasked: string;
  attempted: boolean;
  /** Google called `gm_authFailure` — the key reached Google and was rejected. */
  authFailure: boolean;
  /** ms the last successful load took, for the debug readout. */
  durationMs: number | null;
}

let state: LoaderState = 'idle';
let error: string | null = null;
let attempted = false;
let authFailure = false;
let durationMs: number | null = null;
let inflight: Promise<GoogleMapsApi> | null = null;
let script: HTMLScriptElement | null = null;
let loadedSignature: string | null = null;
let configRevision = 0;

const listeners = new Set<() => void>();

/** Fires on loader changes *and* on config changes (a pasted key, a cleared one). */
export function subscribeGoogleMaps(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  // Any state change also invalidates the memoised status snapshot, so a
  // component that renders `getGoogleMapsStatus()` after this cannot see a
  // stale `loader` field.
  configRevision += 1;
  statusCache = null;
  for (const listener of [...listeners]) listener();
}

export function readConfigRevision(): number {
  return configRevision;
}

/** Call after a runtime key arrives so every subscriber re-reads the status. */
export function notifyGoogleMapsConfigChanged(): void {
  emit();
}

export function getLoaderSnapshot(keyMasked = '—'): LoaderSnapshot {
  return { state, error, attempted, authFailure, keyMasked, durationMs };
}

/* ------------------------------------------------------------------ */
/* Status — the single answer to "is the key actually there?"          */
/* ------------------------------------------------------------------ */

export type MapsVerdict = 'ready' | 'loading' | 'failed' | 'not-loaded' | 'needs-key';

export type BasemapChoice = 'auto' | 'sim' | 'live';

export interface GoogleMapsStatus {
  /** `VITE_GOOGLE_MAPS_API_KEY` (or an override) delivered a usable key. */
  configured: boolean;
  /** The key is usable *and* the API is loaded. */
  available: boolean;
  verdict: MapsVerdict;
  /** One sentence, safe to show in the UI and print in the console. */
  summary: string;
  resolution: KeyResolution;
  inspection: KeyInspection;
  keyMasked: string;
  keyLength: number;
  /** Which name we found it under — `null` when an override supplied it. */
  envName: string | null;
  mapId: string | null;
  loader: LoaderSnapshot;
  /** VITE_* variables that reached the bundle; names only, never values. */
  envVarsSeen: string[];
  /** Env slots that are absent, so the UI can say exactly what to create. */
  missingEnvVars: string[];
  mode: string;
  isDev: boolean;
  scriptSrc: string;
  fix: string[];
  /** True when anything can block network access to the script host. */
  offline: boolean;
}

function describeVerdict(status: Omit<GoogleMapsStatus, 'verdict' | 'summary'>): {
  verdict: MapsVerdict;
  summary: string;
} {
  if (!status.configured) {
    return {
      verdict: 'needs-key',
      summary: `${GOOGLE_MAPS_KEY_VAR} is not set — SURAKSHA renders the built-in simulated map.`,
    };
  }
  if (status.loader.authFailure) {
    return {
      verdict: 'failed',
      summary: `Google rejected the key ${status.keyMasked}. Enable "Maps JavaScript API" and check the key's HTTP-referrer restriction.`,
    };
  }
  if (status.loader.state === 'ready') {
    return { verdict: 'ready', summary: `Live basemap ready — key ${status.keyMasked} from ${describeSource(status.resolution)}.` };
  }
  if (status.loader.state === 'loading') {
    return { verdict: 'loading', summary: `Loading the Maps JS API with key ${status.keyMasked}…` };
  }
  if (status.loader.state === 'error') {
    return { verdict: 'failed', summary: `Maps JS API failed to load: ${status.loader.error ?? 'unknown error'}` };
  }
  if (status.loader.state === 'idle') {
    return {
      verdict: 'not-loaded',
      summary: `Key ${status.keyMasked} is configured, but the live map is not switched on for this screen yet.`,
    };
  }
  return {
    verdict: 'not-loaded',
    summary: `Key ${status.keyMasked} found, waiting for the Maps JS API.`,
  };
}

/** Cached per config revision: the store ticks once a second and this is called on every map render. */
let statusCache: { revision: number; status: GoogleMapsStatus } | null = null;

export function getGoogleMapsStatus(): GoogleMapsStatus {
  if (statusCache && statusCache.revision === configRevision) return statusCache.status;

  const resolution = resolveGoogleMapsKey();
  const inspection = inspectGoogleMapsKey(resolution);
  const configured = inspection.usable;
  const missingEnvVars = resolution.lookedFor.filter((name) => !envVarNames().includes(name));

  const base = {
    configured,
    available: configured && state === 'ready' && !authFailure,
    resolution,
    inspection,
    keyMasked: configured ? maskKey(resolution.value) : '—',
    keyLength: resolution.value?.length ?? 0,
    envName: resolution.envName,
    mapId: resolveGoogleMapsId(),
    loader: getLoaderSnapshot(configured ? maskKey(resolution.value) : '—'),
    envVarsSeen: envVarNames(),
    missingEnvVars,
    mode: appMode(),
    isDev: isDevBuild(),
    scriptSrc: GOOGLE_MAPS_SCRIPT,
    fix: configured ? [] : buildFixSteps(resolution),
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  };

  const { verdict, summary } = describeVerdict(base);
  const status: GoogleMapsStatus = { ...base, verdict, summary };
  statusCache = { revision: configRevision, status };
  return status;
}

/**
 * Multi-line plain text for `console.log` / `surakshaMaps.status()`.
 * Written to be readable when pasted into a bug report.
 */
export function formatGoogleMapsStatus(status = getGoogleMapsStatus()): string {
  const icon = status.verdict === 'ready' ? '✅' : status.verdict === 'loading' ? '⏳' : status.verdict === 'failed' ? '❌' : '⚠️';
  const lines: string[] = [
    `${icon} Google Maps — ${status.verdict.replace('-', ' ')}`,
    `  key           : ${status.keyMasked}`,
    `  present       : ${status.configured ? 'yes' : 'no'}`,
    `  source        : ${describeSource(status.resolution)}`,
    `  env variable  : ${status.envName ?? (status.missingEnvVars.length ? status.missingEnvVars[0] : '—')}`,
    `  length        : ${status.keyLength}${status.keyLength && status.keyLength !== 39 ? ' (expected 39)' : ''}`,
    `  check         : ${status.inspection.message}`,
    `  api loaded    : ${status.loader.state}${status.loader.error ? ` — ${status.loader.error}` : ''}`,
    `  auth failure  : ${status.loader.authFailure ? 'yes — Google rejected this key' : 'no'}`,
    `  map id        : ${status.mapId ?? '— (raster tiles, optional)'}`,
    `  mode/network  : ${status.mode} · ${status.offline ? 'offline' : 'online'}`,
    `  VITE_ vars in : ${status.envVarsSeen.length ? status.envVarsSeen.join(', ') : '(none)'}`,
  ];
  if (status.inspection.warnings.length) {
    lines.push('  warnings:');
    for (const warning of status.inspection.warnings) lines.push(`    • ${warning}`);
  }
  if (status.fix.length) {
    lines.push('  do this:');
    status.fix.forEach((step, index) => lines.push(`    ${index + 1}. ${step}`));
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export class GoogleMapsError extends Error {
  readonly kind: 'no-key' | 'placeholder' | 'network' | 'timeout' | 'rejected' | 'unknown';
  readonly fix: string[];

  constructor(kind: GoogleMapsError['kind'], message: string, fix: string[] = []) {
    super(message);
    this.name = 'GoogleMapsError';
    this.kind = kind;
    this.fix = fix;
  }
}

function buildScriptUrl(key: string, mapId: string | null): string {
  const params = new URLSearchParams({
    key,
    v: 'weekly',
    loading: 'async',
    callback: '__SURAKSHA_MAPS_CALLBACK__',
  });
  if (mapId) params.set('map_ids', mapId);
  return `${GOOGLE_MAPS_SCRIPT}?${params.toString()}`;
}

/**
 * Load the Maps JS API once per key.
 *
 * `loading=async` + a JSONP callback is Google's recommended bootstrap: it does
 * not block first paint, which matters here because the simulated map is already
 * on screen. Rejecting on `gm_authFailure` is what turns "grey rectangle" into
 * an actual message.
 */
export function loadGoogleMapsApi(): Promise<GoogleMapsApi> {
  const existing = peekGoogleMapsApi();
  const resolution = resolveGoogleMapsKey();
  const inspection = inspectGoogleMapsKey(resolution);
  const mapId = resolveGoogleMapsId();
  const signature = `${resolution.value ?? ''}|${mapId ?? ''}`;

  // `loadedSignature === null` with an API already on the window means a hot
  // reload reset this module while the script tag survived; adopt it instead of
  // appending a second Maps script.
  if (existing && (loadedSignature === null || loadedSignature === signature)) {
    loadedSignature = signature;
    if (state !== 'ready') {
      state = 'ready';
      error = null;
      emit();
    }
    return Promise.resolve(existing);
  }

  if (inflight && loadedSignature === signature) return inflight;

  const key = resolution.value;
  if (!key || !inspection.usable) {
    state = 'error';
    attempted = true;
    error = inspection.message;
    emit();
    return Promise.reject(
      new GoogleMapsError(
        inspection.verdict === 'placeholder' ? 'placeholder' : 'no-key',
        inspection.message,
        buildFixSteps(resolution),
      ),
    );
  }

  if (typeof document === 'undefined') {
    return Promise.reject(new GoogleMapsError('unknown', 'No document available to attach the Maps script to.'));
  }

  if (script) {
    script.remove();
    script = null;
  }

  const startedAt = Date.now();
  state = 'loading';
  attempted = true;
  error = null;
  authFailure = false;
  emit();

  // Recorded up-front: it is also what makes a second `loadGoogleMapsApi()` call
  // while this one is in flight return the same promise instead of appending a
  // second Maps script tag.
  loadedSignature = signature;

  const promise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const google = asGoogleWindow();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    google.gm_authFailure = () => {
      authFailure = true;
      state = 'error';
      error = `Google refused key ${maskKey(key)} — API not enabled, key invalid, or the referrer is not allowed.`;
      emit();
      finish(() => reject(new GoogleMapsError('rejected', error ?? 'Auth failure')));
    };

    google.__SURAKSHA_MAPS_CALLBACK__ = () => {
      const api = peekGoogleMapsApi();
      if (!api) {
        finish(() => reject(new GoogleMapsError('unknown', 'Maps script ran but window.google.maps is still missing.')));
        return;
      }
      durationMs = Date.now() - startedAt;
      state = 'ready';
      error = null;
      emit();
      finish(() => resolve(api));
    };

    const element = document.createElement('script');
    element.id = 'suraksha-google-maps-api';
    element.src = buildScriptUrl(key, mapId);
    element.async = true;
    element.defer = true;
    element.onerror = () => {
      state = 'error';
      error = `Could not fetch ${GOOGLE_MAPS_SCRIPT} (offline, an ad blocker, or a CSP that does not allow maps.googleapis.com).`;
      emit();
      finish(() =>
        reject(
          new GoogleMapsError(
            'network',
            error ?? 'Script failed',
            statusFixForNetwork(),
          ),
        ),
      );
    };
    script = element;
    document.head.appendChild(element);

    timer = setTimeout(() => {
      state = 'error';
      error = 'Timed out after 15s waiting for maps.googleapis.com.';
      emit();
      finish(() => reject(new GoogleMapsError('timeout', error ?? 'Timeout', statusFixForNetwork())));
    }, 15_000);
  });

  inflight = promise;
  promise.catch(() => {
    // Allow a retry after a failure without reusing the rejected promise.
    if (inflight === promise) inflight = null;
  });
  return promise;
}

function statusFixForNetwork(): string[] {
  return [
    'Check the network tab: the request should be GET https://maps.googleapis.com/maps/api/js?key=…',
    'Disable ad blockers / privacy extensions for this origin and reload.',
    'If the page sets a Content-Security-Policy, add https://maps.googleapis.com to script-src and https://*.gstatic.com to img-src.',
    'The simulated map keeps working either way — nothing else in SURAKSHA depends on Google.',
  ];
}

/** Force the next `loadGoogleMapsApi()` to re-run (used by the retry button). */
export function resetGoogleMapsLoader(): void {
  state = 'idle';
  error = null;
  attempted = false;
  authFailure = false;
  durationMs = null;
  inflight = null;
  loadedSignature = null;
  if (script) {
    script.remove();
    script = null;
  }
  emit();
}

/**
 * Store a key for this tab only (sessionStorage) and reload.
 * Returns false when storage is blocked by the browser.
 */
export function setSessionMapsKey(key: string | null): boolean {
  const saved = writeSessionValue(SESSION_KEY_SLOT, key);
  writeSessionValue(SESSION_ID_SLOT, null);
  resetGoogleMapsLoader();
  return saved;
}

/* ------------------------------------------------------------------ */
/* Debug surface                                                       */
/* ------------------------------------------------------------------ */

export interface GoogleMapsDebugApi {
  /** The full structured status — same object the UI renders. */
  status(): GoogleMapsStatus;
  /** The same status as readable text, printed to the console. */
  check(): GoogleMapsStatus;
  /** Actually hit the network and tell you what happened. */
  test(): Promise<GoogleMapsStatus>;
  /** Use a key for this tab only, without touching .env. */
  useKey(key: string): boolean;
  clearKey(): void;
  /** What the map is doing right now, and why. */
  basemap(): { choice: BasemapChoice; configured: boolean };
  /** Basemap choice for the whole app; 'auto' follows the key. */
  setBasemap(choice: BasemapChoice): void;
  live(): void;
  simulated(): void;
  /** Re-run the boot banner. */
  banner(): void;
  help(): string;
  /** Importable by tests; the window global is a thin alias for this. */
  version: 1;
}

export const GOOGLE_MAPS_DEBUG_HELP = [
  'surakshaMaps.status()   → full Google Maps diagnostics object',
  'surakshaMaps.check()    → the same, printed as text',
  'surakshaMaps.test()     → load maps.googleapis.com for real and report',
  "surakshaMaps.useKey('AIza…') → use a key for this tab only (sessionStorage)",
  'surakshaMaps.clearKey() → drop that override and go back to .env',
  'surakshaMaps.basemap()    → why the map looks like this',
  'surakshaMaps.live() / .simulated() / .setBasemap("auto")',
].join('\n');

export function installGoogleMapsDebug(api: GoogleMapsDebugApi): void {
  if (typeof window === 'undefined') return;
  const target = window as unknown as Record<string, unknown>;
  target.surakshaMaps = api;
  const namespace = (target.__SURAKSHA__ ?? {}) as Record<string, unknown>;
  namespace.maps = api;
  target.__SURAKSHA__ = namespace;
}

export function createGoogleMapsDebugApi(deps: {
  setBasemap: (choice: BasemapChoice) => void;
  readBasemap: () => BasemapChoice;
}): GoogleMapsDebugApi {
  const log = (text: string) => {
    if (typeof console !== 'undefined') console.log(text);
  };

  const status = () => getGoogleMapsStatus();

  return {
    status,
    check() {
      log(formatGoogleMapsStatus());
      return status();
    },
    async test() {
      resetGoogleMapsLoader();
      try {
        await loadGoogleMapsApi();
        const next = status();
        log(`✅ Maps JS API loaded in ${next.loader.durationMs ?? 0}ms (key ${next.keyMasked}).`);
        return next;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        log(`❌ ${message}`);
        const fix = cause instanceof GoogleMapsError ? cause.fix : [];
        if (fix.length) log(fix.map((step, index) => `   ${index + 1}. ${step}`).join('\n'));
        return status();
      }
    },
    useKey(key: string) {
      const saved = setSessionMapsKey(key);
      log(
        saved
          ? `Key ${maskKey(key)} stored for this tab. Reload if the map did not switch on its own.`
          : 'sessionStorage is blocked, so the override could not be saved. Use .env instead.',
      );
      return saved;
    },
    clearKey() {
      setSessionMapsKey(null);
      log('Cleared the session key override — SURAKSHA reads import.meta.env again.');
    },
    basemap() {
      const choice = deps.readBasemap();
      const configured = getGoogleMapsStatus().configured;
      log(`Basemap preference: ${choice} · key configured: ${configured ? 'yes' : 'no'} → ${resolveBasemap(choice, configured).reason}`);
      return { choice, configured };
    },
    setBasemap(choice) {
      deps.setBasemap(choice);
      log(`Basemap preference → ${choice}.`);
    },
    live() {
      deps.setBasemap('live');
      log('Basemap preference → live (Google).');
    },
    simulated() {
      deps.setBasemap('sim');
      log('Basemap preference → simulated (built-in SVG).');
    },
    banner() {
      printGoogleMapsBanner();
    },
    help: () => {
      log(GOOGLE_MAPS_DEBUG_HELP);
      return GOOGLE_MAPS_DEBUG_HELP;
    },
    version: 1,
  };
}

/**
 * The boot banner. Prints once, loudly, in dev; one line in production so a
 * judge on the hosted preview can still see why the map is simulated.
 */
export function printGoogleMapsBanner(): void {
  if (typeof console === 'undefined') return;
  const status = getGoogleMapsStatus();
  if (status.verdict === 'ready' || status.verdict === 'loading') return;
  const text = formatGoogleMapsStatus(status);
  if (status.isDev) {
    console.groupCollapsed(
      status.verdict === 'needs-key' ? '🗺️ SURAKSHA · maps: simulated (no key)' : '🗺️ SURAKSHA · maps: check the status below',
    );
    console.log(text);
    console.log('Fix it, then: surakshaMaps.test()');
    console.groupEnd();
  } else {
    console.info(`[suraksha][maps] ${status.summary}`);
  }
}
