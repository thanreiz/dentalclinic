/**
 * GET /api/cron/reminders (Vercel Cron, 0 1 * * * UTC = 9:00 AM Manila). FR13 / Rule 8.
 * Requires `Authorization: Bearer ${CRON_SECRET}` (constant-time compare). CRON_SECRET unset
 * or empty -> 500 cron_not_configured (never open). -> { sent, failed, date }.
 */
import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/http';
import { errorResponse } from '@/lib/services/errors';
import { cronAuthorized, runReminders } from '@/lib/services/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret.trim()) {
    console.error('[cron:reminders] CRON_SECRET is not set; refusing to run');
    return jsonError(500, 'cron_not_configured', { message: 'CRON_SECRET is not set' });
  }
  if (!cronAuthorized(req.headers.get('authorization'), secret)) {
    return jsonError(401, 'unauthorized', { message: 'Missing or invalid cron secret' });
  }
  try {
    const r = await runReminders();
    console.log(`[cron:reminders] ${r.date}: sent ${r.sent}, failed ${r.failed}${r.skipped ? ` (${r.skipped})` : ''}`);
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err, 'GET /api/cron/reminders');
  }
}
