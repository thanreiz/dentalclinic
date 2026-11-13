/**
 * GET /api/reports/export?month=YYYY-MM&threshold=N&format=csv|xlsx (staff).
 * Downloads the Reports page data for the clinic's own records: month totals, by dentist, by
 * service, by channel, repeat no-shows, and every appointment in the month. xlsx has one sheet
 * per table; csv puts them in one file as titled sections.
 */
import { z } from 'zod';
import { parseSearchParams, requireStaffApi } from '@/lib/http';
import { buildReportSheets } from '@/lib/export/report-sheets';
import { toCsv } from '@/lib/export/csv';
import { toXlsx } from '@/lib/export/xlsx';
import { defaultNoShowThreshold } from '@/lib/rules';
import { errorResponse } from '@/lib/services/errors';
import { monthOf, todayManila } from '@/lib/time';
import { monthSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exportQuerySchema = z.object({
  month: monthSchema.optional(),
  threshold: z.coerce.number().int().min(1).max(100).optional(),
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
});

export async function GET(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const parsed = parseSearchParams(new URL(req.url).searchParams, exportQuerySchema);
  if (!parsed.ok) return parsed.response;
  const month = parsed.data.month ?? monthOf(todayManila());
  const threshold = parsed.data.threshold ?? defaultNoShowThreshold();
  try {
    const sheets = await buildReportSheets(month, threshold);
    const name = `clinic-report-${month}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (parsed.data.format === 'csv') {
      return new Response(toCsv(sheets), {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` },
      });
    }
    return new Response(Buffer.from(toXlsx(sheets)), {
      headers: {
        ...headers,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}.xlsx"`,
      },
    });
  } catch (err) {
    return errorResponse(err, 'GET /api/reports/export');
  }
}
