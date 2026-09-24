import { appEnv } from '@/lib/env';

/**
 * Thin fetch wrapper for the SURAKSHA reporting API.
 *
 * Two behaviours matter for this product:
 *  - **Timeouts are first-class.** The 30-second report contract depends on a
 *    request actually giving up, so every call has an explicit deadline and
 *    `AbortError` is reported as a timeout rather than a generic failure.
 *  - **Offline is not an error.** When the browser reports no connection the
 *    caller is told `offline: true` so it can queue the work and tell the truth
 *    in the UI instead of showing a scary failure.
 */

export interface ApiErrorInfo {
  status: number;
  message: string;
  offline: boolean;
  timeout: boolean;
  code?: string;
}

export class ApiRequestError extends Error implements ApiErrorInfo {
  status: number;
  offline: boolean;
  timeout: boolean;
  code?: string;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = 'ApiRequestError';
    this.status = info.status;
    this.offline = info.offline;
    this.timeout = info.timeout;
    this.code = info.code;
  }

  get isNetworkProblem(): boolean {
    return this.offline || this.status === 0 || this.timeout;
  }
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Sent through for the device-only mode where there is no Supabase session. */
  ownerId?: string;
  headers?: Record<string, string>;
}

export function apiUrl(path: string): string {
  const base = appEnv.apiBaseUrl.replace(/\/$/, '');
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, token, timeoutMs = 12_000, ownerId, headers } = options;

  if (!navigator.onLine && method !== 'GET') {
    throw new ApiRequestError({
      status: 0,
      offline: true,
      timeout: false,
      message: 'No internet connection. The action was stored on this device instead.',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const abortFromCaller = () => controller.abort('caller');
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const startedAt = Date.now();

  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ownerId ? { 'x-suraksha-owner': ownerId } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text.slice(0, 300) };
      }
    }

    if (!response.ok) {
      const payload = parsed as { error?: string; code?: string } | undefined;
      throw new ApiRequestError({
        status: response.status,
        offline: false,
        timeout: false,
        message: payload?.error ?? `The server answered with HTTP ${response.status}.`,
        code: payload?.code,
      });
    }

    const envelope = parsed as { ok?: boolean; data?: T } | undefined;
    // The reporting server wraps everything in `{ ok, data }`; accept raw bodies too.
    return (envelope && typeof envelope === 'object' && 'data' in envelope ? (envelope.data as T) : (parsed as T));
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;

    const aborted = (error as Error)?.name === 'AbortError';
    const elapsed = Date.now() - startedAt;
    const timedOut = aborted && (controller.signal.reason === 'timeout' || elapsed >= timeoutMs - 50);

    if (timedOut) {
      throw new ApiRequestError({
        status: 0,
        offline: false,
        timeout: true,
        message: `The server did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
      });
    }
    if (aborted) {
      throw new ApiRequestError({ status: 0, offline: false, timeout: false, message: 'The request was cancelled.' });
    }

    throw new ApiRequestError({
      status: 0,
      offline: !navigator.onLine,
      timeout: false,
      message: !navigator.onLine
        ? 'No internet connection available.'
        : 'The server could not be reached. Check your connection or try again.',
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export interface HealthResult {
  reachable: boolean;
  supabase: 'connected' | 'not-configured' | 'unreachable' | 'unknown';
  version?: string;
  checkedAt: string;
  message: string;
}

/** Never throws: the UI uses it to explain the current state of the backend. */
export async function checkHealth(timeoutMs = 5000): Promise<HealthResult> {
  const checkedAt = new Date().toISOString();
  try {
    const data = await apiFetch<{
      ok: boolean;
      service: string;
      version: string;
      time: string;
      supabase: HealthResult['supabase'];
    }>('/health', { timeoutMs });

    return {
      reachable: Boolean(data?.ok),
      supabase: data?.supabase ?? 'unknown',
      version: data?.version,
      checkedAt,
      message: data?.ok
        ? `Reporting server reachable${data.supabase === 'connected' ? ' and connected to Supabase' : ''}.`
        : 'The reporting server answered unexpectedly.',
    };
  } catch (error) {
    return {
      reachable: false,
      supabase: 'unknown',
      checkedAt,
      message:
        error instanceof ApiRequestError
          ? error.message
          : 'The reporting server could not be reached.',
    };
  }
}

/** Exponential backoff used by the outbox and report retries. */
export function backoffDelayMs(attempt: number, base = 5_000, max = 5 * 60_000): number {
  const delay = base * 2 ** Math.max(0, attempt - 1);
  const jitter = delay * 0.2 * Math.random();
  return Math.min(max, delay + jitter);
}
