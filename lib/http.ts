/**
 * Tiny route-handler helpers so every API returns the same JSON error shape:
 *   { error: 'validation_error', message, issues: { field: message } }
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { SESSION_COOKIE, verifySession } from './session';
import type { StaffUser } from './types';
import { fieldErrors } from './validation';

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Parse a JSON request body with a Zod schema. Returns data or a ready 400 response. */
export async function parseJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S>; raw: unknown } | { ok: false; response: NextResponse }> {
  const body = await readJsonBody(req);
  if (!body.ok) return body;
  return parseWith(schema, body.raw);
}

/** Largest JSON body any route accepts (the biggest real one, a dentist week, is < 2 KB). */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * Read a JSON request body defensively (SECURITY-REVIEW I1, I3):
 * - a non-empty body must be sent as `Content-Type: application/json` (else 415);
 * - bodies over MAX_JSON_BODY_BYTES are refused (413) before parsing;
 * - malformed JSON -> 400 invalid_json.
 * `allowEmpty` returns `raw: undefined` for an empty body (POST routes with no input, e.g. logout).
 */
export async function readJsonBody(
  req: Request,
  opts: { allowEmpty?: boolean } = {},
): Promise<{ ok: true; raw: unknown } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) {
    return { ok: false, response: jsonError(413, 'payload_too_large', { message: 'Request body is too large' }) };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', { message: 'Request body must be JSON' }) };
  }
  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) {
    return { ok: false, response: jsonError(413, 'payload_too_large', { message: 'Request body is too large' }) };
  }
  if (!text.trim()) {
    if (opts.allowEmpty) return { ok: true, raw: undefined };
    return { ok: false, response: jsonError(400, 'invalid_json', { message: 'Request body must be JSON' }) };
  }
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/json')) {
    return {
      ok: false,
      response: jsonError(415, 'unsupported_media_type', { message: 'Send the request body as application/json' }),
    };
  }
  try {
    return { ok: true, raw: JSON.parse(text) };
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', { message: 'Request body must be JSON' }) };
  }
}

/** Parse URLSearchParams (query string) with a Zod schema. */
export function parseSearchParams<S extends z.ZodType>(
  params: URLSearchParams,
  schema: S,
): { ok: true; data: z.infer<S>; raw: unknown } | { ok: false; response: NextResponse } {
  return parseWith(schema, Object.fromEntries(params.entries()));
}

export function parseWith<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): { ok: true; data: z.infer<S>; raw: unknown } | { ok: false; response: NextResponse } {
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError(400, 'validation_error', {
        message: 'Please check the highlighted fields',
        issues: fieldErrors(result.error),
      }),
    };
  }
  return { ok: true, data: result.data, raw };
}

// ---------- staff session from the Request (Backend-B) ----------

/** Read one cookie from a Request's Cookie header. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return undefined;
}

/** Staff user from the request's session cookie, or null. Never throws. */
export async function staffFromRequest(req: Request): Promise<StaffUser | null> {
  try {
    return await verifySession(readCookie(req, SESSION_COOKIE));
  } catch {
    return null;
  }
}

/**
 * Route-handler guard (defense in depth beyond middleware). Same check as lib/auth `requireStaff()`
 * (verifies the signed `session` cookie) but reads it from the Request, so handlers can also be
 * called directly in integration tests outside a Next request scope.
 *   const auth = await requireStaffApi(req); if (!auth.ok) return auth.response;
 */
export async function requireStaffApi(
  req: Request,
): Promise<{ ok: true; user: StaffUser } | { ok: false; response: NextResponse }> {
  const user = await staffFromRequest(req);
  if (!user) return { ok: false, response: jsonError(401, 'unauthorized', { message: 'Please log in again.' }) };
  return { ok: true, user };
}

/** Dynamic route context (Next 15: params is a Promise). */
export type IdRouteContext = { params: Promise<{ id: string }> };

/** Parse the `[id]` route param; 400 when it is not a positive integer. */
export async function parseIdParam(ctx: IdRouteContext): Promise<{ ok: true; id: number } | { ok: false; response: NextResponse }> {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!/^\d+$/.test(id ?? '') || !Number.isSafeInteger(n) || n <= 0) {
    return { ok: false, response: jsonError(400, 'validation_error', { message: 'Invalid id', issues: { id: 'Must be a positive id' } }) };
  }
  return { ok: true, id: n };
}

/** Parse an optional JSON body: empty body -> {} (for POST routes with no required input). */
export async function parseOptionalJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S>; raw: unknown } | { ok: false; response: NextResponse }> {
  const body = await readJsonBody(req, { allowEmpty: true });
  if (!body.ok) return body;
  return parseWith(schema, body.raw === undefined ? {} : body.raw);
}
