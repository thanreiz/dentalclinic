/** GET /api/patients?q=&page= (staff): booking-form search, 20 per page -> { rows, total, page, pageSize }. */
import { NextResponse } from 'next/server';
import { parseSearchParams, requireStaffApi } from '@/lib/http';
import { searchPatients } from '@/lib/queries/patients';
import { errorResponse } from '@/lib/services/errors';
import { patientSearchSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export async function GET(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const parsed = parseSearchParams(new URL(req.url).searchParams, patientSearchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const r = await searchPatients(parsed.data.q, parsed.data.page, PAGE_SIZE);
    return NextResponse.json({ ...r, page: parsed.data.page, pageSize: PAGE_SIZE });
  } catch (err) {
    return errorResponse(err, 'GET /api/patients');
  }
}
