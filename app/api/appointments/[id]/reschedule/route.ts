/**
 * POST /api/appointments/[id]/reschedule { date, start, dentistId, chairId } (staff, FR4, Rule 11).
 * 200 { ok, newId } | 409 invalid_transition | in_past | outside_hours | dentist_conflict | chair_conflict.
 */
import { NextResponse } from 'next/server';
import { parseIdParam, parseJsonBody, requireStaffApi, type IdRouteContext } from '@/lib/http';
import { rescheduleAppointment } from '@/lib/services/appointments';
import { errorResponse } from '@/lib/services/errors';
import { rescheduleSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: IdRouteContext) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const id = await parseIdParam(ctx);
  if (!id.ok) return id.response;
  const parsed = await parseJsonBody(req, rescheduleSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await rescheduleAppointment(id.id, parsed.data));
  } catch (err) {
    return errorResponse(err, 'POST /api/appointments/[id]/reschedule');
  }
}
