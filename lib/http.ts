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
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', { message: 'Request body must be JSON' }) };
  }
  return parseWith(schema, raw);
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
  const text = await req.text();
  if (!text.trim()) return parseWith(schema, {});
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', { message: 'Request body must be JSON' }) };
  }
  return parseWith(schema, raw);
}
