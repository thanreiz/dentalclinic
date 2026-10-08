/**
 * GET /api/slots?date=YYYY-MM-DD&serviceId=1&dentistId=2|any  (public, Rule 5)
 * -> { slots: [{ start, end, dentistIds }] }. No patient data.
 * Public: date must be today..today+60 (Manila). Staff session: up to 366 days ahead.
 * Optional `excludeAppointmentId` (staff only, for reschedule) treats that appointment's own
 * time as free.
 */
import { NextResponse } from 'next/server';
import { jsonError, parseSearchParams, staffFromRequest } from '@/lib/http';
import { errorResponse } from '@/lib/services/errors';
import { assertDateInWindow, getSlots, PUBLIC_BOOKING_WINDOW_DAYS, STAFF_BOOKING_WINDOW_DAYS } from '@/lib/services/slots';
import { slotsQuerySchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const parsed = parseSearchParams(params, slotsQuerySchema);
  if (!parsed.ok) return parsed.response;

  const staff = await staffFromRequest(req);
  const excludeRaw = params.get('excludeAppointmentId');
  let excludeAppointmentId = 0;
  if (excludeRaw !== null && excludeRaw !== '') {
    if (!staff) return jsonError(401, 'unauthorized', { message: 'Please log in again.' });
    excludeAppointmentId = Number(excludeRaw);
    if (!Number.isSafeInteger(excludeAppointmentId) || excludeAppointmentId <= 0) {
      return jsonError(400, 'validation_error', { message: 'Invalid excludeAppointmentId', issues: { excludeAppointmentId: 'Must be a positive id' } });
    }
  }

  try {
    assertDateInWindow(parsed.data.date, staff ? STAFF_BOOKING_WINDOW_DAYS : PUBLIC_BOOKING_WINDOW_DAYS);
    const slots = await getSlots({ ...parsed.data, excludeAppointmentId });
    return NextResponse.json({ slots }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err, 'GET /api/slots');
  }
}
