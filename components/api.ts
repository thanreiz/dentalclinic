/**
 * Tiny client-side fetch wrapper for the JSON route handlers.
 * Never throws: network failures come back as { ok: false, status: 0 }.
 */
export type ApiResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  data: T & { error?: string; message?: string; issues?: Record<string, string> };
};

export async function api<T = Record<string, unknown>>(
  url: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: opts.signal,
    });
    const data = (await res.json().catch(() => ({}))) as ApiResult<T>['data'];
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    return {
      ok: false,
      status: 0,
      data: { error: 'network_error', message: 'Could not reach the server. Check your connection and try again.' } as ApiResult<T>['data'],
    };
  }
}

/** Human message for a failed call (falls back to a generic line). */
export function errorMessage(r: ApiResult<unknown>, fallback = 'Something went wrong. Please try again.'): string {
  if (r.status === 401) return 'Your session has ended. Please log in again.';
  return (typeof r.data?.message === 'string' && r.data.message) || fallback;
}
