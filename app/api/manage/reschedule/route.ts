/**
 * POST /api/manage/reschedule { token, date, start } (public; the signed token from the patient's
 * confirmation / reminder is the key). Sends a reschedule REQUEST to the clinic's queue (same
 * dentist); the current appointment stays until staff approve it, first come first served.
 * 200 { ok, requestId, date, start, position } | 404 invalid_link | 409 slot_unavailable { slots } |
 * 409 invalid_transition | in_past | outside_hours.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deferNotice, jsonError, parseJsonBody } from '@/lib/http';
import { verifyManageToken } from '@/lib/manage-link';
import { PATIENT_RESCHEDULE_WINDOW_DAYS, requestPatientReschedule } from '@/lib/services/appointments';
import { errorResponse } from '@/lib/services/errors';
import { clientIp, recordRequest, requestRetryAfter } from '@/lib/services/rate-limit';
import { assertDateInWindow } from '@/lib/services/slots';
import { dateSchema, timeSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ token: z.string().max(80), date: dateSchema, start: timeSchema });

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const id = verifyManageToken(parsed.data.token);
  if (!id) return jsonError(404, 'invalid_link', { message: 'This link is no longer valid. Please contact the clinic.' });

  const ip = clientIp(req);
  const retry = requestRetryAfter(ip);
  if (retry > 0) return jsonError(429, 'rate_limited', { message: 'Too many changes. Please try again later.' });

  try {
    assertDateInWindow(parsed.data.date, PATIENT_RESCHEDULE_WINDOW_DAYS);
    const r = await requestPatientReschedule(id, { date: parsed.data.date, start: parsed.data.start }, { defer: deferNotice });
    recordRequest(ip);
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err, 'POST /api/manage/reschedule');
  }
}
