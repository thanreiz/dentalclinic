/**
 * POST /api/requests (public, FR1/FR2/FR9). Honeypot `website` filled -> fake 201, nothing saved.
 * 201 { ok: true } | 400 validation_error | 409 { error: 'slot_taken', message, slots }
 * | 429 { error: 'too_many_requests', message } (per-IP limiter with Retry-After, or the DB-backed
 * per-contact / clinic-wide caps; SECURITY-REVIEW H1) | 413/415 (body too large / not JSON).
 * Returns no patient data or ids.
 */
import { NextResponse } from 'next/server';
import { jsonError, parseWith, readJsonBody } from '@/lib/http';
import { createOnlineRequest } from '@/lib/services/booking';
import { errorResponse } from '@/lib/services/errors';
import { clientIp, recordRequest, requestRetryAfter } from '@/lib/services/rate-limit';
import { tooManyFromDeviceMessage } from '@/lib/services/request-limits';
import { assertDateInWindow, PUBLIC_BOOKING_WINDOW_DAYS } from '@/lib/services/slots';
import { bookingRequestSchema, honeypotTripped } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const raw = body.raw;
  // Spam trap: look successful, save nothing.
  if (honeypotTripped(raw)) return NextResponse.json({ ok: true }, { status: 201 });

  // Best-effort per-IP brake (per server instance); the DB caps in createOnlineRequest are the real limit.
  const ip = clientIp(req);
  const wait = requestRetryAfter(ip);
  if (wait > 0) {
    const res = jsonError(429, 'too_many_requests', { message: tooManyFromDeviceMessage() });
    res.headers.set('Retry-After', String(wait));
    return res;
  }

  const parsed = parseWith(bookingRequestSchema, raw);
  if (!parsed.ok) return parsed.response;

  try {
    assertDateInWindow(parsed.data.date, PUBLIC_BOOKING_WINDOW_DAYS);
    await createOnlineRequest(parsed.data);
    recordRequest(ip);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'POST /api/requests');
  }
}
