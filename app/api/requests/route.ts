/**
 * POST /api/requests (public, FR1/FR2/FR9). Honeypot `website` filled -> fake 201, nothing saved.
 * 201 { ok: true } | 400 validation_error | 409 { error: 'slot_taken', message, slots }.
 * Returns no patient data or ids.
 */
import { NextResponse } from 'next/server';
import { jsonError, parseWith } from '@/lib/http';
import { createOnlineRequest } from '@/lib/services/booking';
import { errorResponse } from '@/lib/services/errors';
import { assertDateInWindow, PUBLIC_BOOKING_WINDOW_DAYS } from '@/lib/services/slots';
import { bookingRequestSchema, honeypotTripped } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_json', { message: 'Request body must be JSON' });
  }
  // Spam trap: look successful, save nothing.
  if (honeypotTripped(raw)) return NextResponse.json({ ok: true }, { status: 201 });

  const parsed = parseWith(bookingRequestSchema, raw);
  if (!parsed.ok) return parsed.response;

  try {
    assertDateInWindow(parsed.data.date, PUBLIC_BOOKING_WINDOW_DAYS);
    await createOnlineRequest(parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'POST /api/requests');
  }
}
