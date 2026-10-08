/**
 * GET /api/chairs/free?date&start&(end|serviceId)[&excludeId] (staff, Rule 6)
 * -> { chairs: [{ chairId, chairName }] } free for that time (pending/scheduled rows block a chair).
 * excludeId = the appointment being confirmed/rescheduled (its own chair counts as free).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, parseSearchParams, requireStaffApi } from '@/lib/http';
import { listFreeChairs } from '@/lib/queries/overlap';
import { endTimeOrThrow } from '@/lib/services/booking';
import { errorResponse } from '@/lib/services/errors';
import { getServiceOrThrow } from '@/lib/services/lookups';
import { toMinutes } from '@/lib/time';
import { dateSchema, idSchema, timeSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  date: dateSchema,
  start: timeSchema,
  end: timeSchema.optional(),
  serviceId: idSchema.optional(),
  excludeId: idSchema.optional(),
});

export async function GET(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const parsed = parseSearchParams(new URL(req.url).searchParams, schema);
  if (!parsed.ok) return parsed.response;
  const q = parsed.data;
  try {
    let end = q.end;
    if (!end) {
      if (!q.serviceId) return jsonError(400, 'validation_error', { message: 'Give end or serviceId', issues: { end: 'Required' } });
      end = endTimeOrThrow(q.start, (await getServiceOrThrow(q.serviceId)).duration_minutes);
    }
    if (toMinutes(end) <= toMinutes(q.start)) {
      return jsonError(400, 'validation_error', { message: 'End must be after start', issues: { end: 'End must be after start' } });
    }
    const chairs = await listFreeChairs(q.date, q.start, end, q.excludeId ?? 0);
    return NextResponse.json({ chairs: chairs.map((c) => ({ chairId: c.chair_id, chairName: c.chair_name })) });
  } catch (err) {
    return errorResponse(err, 'GET /api/chairs/free');
  }
}
