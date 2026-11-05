/** Streamed body cap (QA L9), the old-domain redirect (L7) and API cache headers (L4). */
import { describe, expect, it } from 'vitest';
import nextConfig, { OLD_DOMAIN_REDIRECT_SOURCE } from '../../next.config';
import { MAX_JSON_BODY_BYTES, readJsonBody } from '@/lib/http';

function streamed(chunks: string[], headers: Record<string, string> = { 'content-type': 'application/json' }) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Request('http://localhost/x', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
}

describe('readJsonBody: size cap without a Content-Length', () => {
  it('refuses a streamed body over the cap with 413', async () => {
    const big = 'a'.repeat(1024);
    const r = await readJsonBody(streamed(Array.from({ length: 80 }, () => big)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(413);
  });
  it('still parses a small streamed body and an empty one', async () => {
    const ok = await readJsonBody(streamed(['{"a":', '1}']));
    expect(ok).toEqual({ ok: true, raw: { a: 1 } });
    const empty = await readJsonBody(streamed([]), { allowEmpty: true });
    expect(empty).toEqual({ ok: true, raw: undefined });
    expect(MAX_JSON_BODY_BYTES).toBe(64 * 1024);
  });
  it('counts bytes, not characters', async () => {
    const r = await readJsonBody(streamed(['"' + '€'.repeat(30000) + '"']));
    expect(r.ok).toBe(false);
  });
});

describe('old-domain redirect', () => {
  const m = /^\/:path\((.*)\)$/.exec(OLD_DOMAIN_REDIRECT_SOURCE)!;
  const re = new RegExp(`^${m[1]}$`);
  it('skips /api/cron and /api/messenger and their sub-paths only', async () => {
    for (const p of ['api/cron', 'api/cron/reminders', 'api/messenger', 'api/messenger/x']) expect(re.test(p), p).toBe(false);
    for (const p of ['api/cronx', 'api/messengerx', 'api/crons/a', 'book', 'login', 'api/slots', 'api/requests', 'dashboard']) expect(re.test(p), p).toBe(true);
    const redirects = await nextConfig.redirects!();
    expect(redirects[0].source).toBe(OLD_DOMAIN_REDIRECT_SOURCE);
  });
});

describe('API cache headers', () => {
  it('every /api response is private, no-store', async () => {
    const rules = await nextConfig.headers!();
    const api = rules.find((r) => r.source === '/api/:path*')!;
    expect(api.headers).toContainEqual({ key: 'Cache-Control', value: 'private, no-store' });
  });
});
