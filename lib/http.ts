/**
 * Tiny route-handler helpers so every API returns the same JSON error shape:
 *   { error: 'validation_error', message, issues: { field: message } }
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
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
