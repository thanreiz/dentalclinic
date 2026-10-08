/**
 * POST /api/appointments (staff, FR3): book a phone/chat/walk-in visit as `scheduled`.
 * 201 { ok, appointmentId, patientId } | 409 in_past | outside_hours | dentist_conflict |
 * chair_conflict | duplicate_contact { existingPatientId } | 400 validation/unknown_*.
 */
import { NextResponse } from 'next/server';
import { parseJsonBody, requireStaffApi } from '@/lib/http';
import { createStaffBooking } from '@/lib/services/booking';
import { errorResponse } from '@/lib/services/errors';
import { staffBookingSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody(req, staffBookingSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const r = await createStaffBooking(parsed.data);
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'POST /api/appointments');
  }
}
