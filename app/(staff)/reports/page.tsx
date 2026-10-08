import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/lib/auth';
import { getMonthlyReport, getRepeatNoShows } from '@/lib/queries/reports';
import { defaultNoShowThreshold, formatContact, formatRate } from '@/lib/rules';
import { formatDateHuman, monthOf, todayManila } from '@/lib/time';
import type { ReportCounts } from '@/lib/types';
import { monthSchema } from '@/lib/validation';
import { Card, CardHeader, PageHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChartIcon, CheckIcon } from '@/components/ui/icons';
import ReportControls, { ThresholdInput } from './ReportControls';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reports' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Attendance totals per month, dentist, service (FR15) and the repeat no-show list (FR16). */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('/reports');
  const sp = await searchParams;
  const currentMonth = monthOf(todayManila());
  const monthParsed = monthSchema.safeParse(typeof sp.month === 'string' ? sp.month : '');
  const month = monthParsed.success ? monthParsed.data : currentMonth;
  const tRaw = typeof sp.threshold === 'string' ? Number(sp.threshold) : NaN;
  const threshold = Number.isInteger(tRaw) && tRaw >= 1 && tRaw <= 100 ? tRaw : defaultNoShowThreshold();

  const [report, repeat] = await Promise.all([getMonthlyReport(month), getRepeatNoShows(threshold)]);
  const t = report.totals;

  return (
    <>
      <PageHeader title="Reports" description="Computed from recorded appointments each time you open this page." actions={<ReportControls month={month} threshold={threshold} />} />

      <h2 className="mb-3 text-lg font-semibold text-slate-900">{monthLabel(month)}</h2>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Total label="Attended" value={t.attended} cls="text-green-800" />
        <Total label="Cancelled" value={t.cancelled} cls="text-slate-800" hint="Excludes reschedules" />
        <Total label="No-show" value={t.noShow} cls="text-red-700" />
        <Total label="No-show rate" value={formatRate(t.noShowRate)} cls="text-slate-900" hint="No-show ÷ (attended + no-show)" rate={t.noShowRate} />
      </div>

      {t.total === 0 ? (
        <Card className="mb-5">
          <EmptyState icon={<ChartIcon />} title={`No completed visits in ${monthLabel(month)}`} description="Totals appear once appointments are marked attended, cancelled, or no-show." />
        </Card>
      ) : (
        <div className="mb-5 grid gap-5 2xl:grid-cols-2">
          <BreakdownTable title="By dentist" rows={report.byDentist.map((r) => ({ key: r.dentistId, name: r.dentistName, ...r }))} totals={t} />
          <BreakdownTable title="By service" rows={report.byService.map((r) => ({ key: r.serviceId, name: r.serviceName, ...r }))} totals={t} />
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title="Repeat no-shows"
          description={`Patients with ${threshold} or more no-shows (all time). Follow up with them.`}
          actions={<ThresholdInput month={month} threshold={threshold} />}
        />
        {repeat.length === 0 ? (
          <EmptyState icon={<CheckIcon />} title="Nobody reaches this threshold" description={`No patient has ${threshold} or more no-shows.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Patients with at least {threshold} no-shows</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Patient</th>
                  <th scope="col" className="px-4 py-3">Contact number</th>
                  <th scope="col" className="px-4 py-3 text-right">No-shows</th>
                  <th scope="col" className="px-4 py-3">Last no-show</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {repeat.map((p) => (
                  <tr key={p.patientId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/patients/${p.patientId}`} className="font-semibold text-brand-800 hover:underline">
                        {p.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">{formatContact(p.contactNumber)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex min-w-7 justify-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 tabular-nums">{p.noShowCount}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{formatDateHuman(p.lastNoShowDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Total({ label, value, cls, hint, rate }: { label: string; value: number | string; cls: string; hint?: string; rate?: number | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className={cx('mt-1 text-3xl font-semibold tabular-nums', cls)}>{value}</p>
      {rate !== undefined && <RateBar rate={rate} className="mt-2" />}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function RateBar({ rate, className }: { rate: number | null; className?: string }) {
  const pct = rate === null ? 0 : Math.min(100, rate * 100);
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)} aria-hidden="true">
      <div className={cx('h-full rounded-full', pct >= 20 ? 'bg-red-600' : pct >= 10 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
    </div>
  );
}

function BreakdownTable({ title, rows, totals }: { title: string; rows: (ReportCounts & { key: number; name: string })[]; totals: ReportCounts }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">Attendance {title.toLowerCase()}</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">{title === 'By dentist' ? 'Dentist' : 'Service'}</th>
              <th scope="col" className="px-3 py-3 text-right">Attended</th>
              <th scope="col" className="px-3 py-3 text-right">Cancelled</th>
              <th scope="col" className="px-3 py-3 text-right">No-show</th>
              <th scope="col" className="w-40 px-4 py-3">No-show rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="px-4 py-3 font-medium text-slate-900">{r.name}</th>
                <td className="px-3 py-3 text-right tabular-nums">{r.attended}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.cancelled}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.noShow}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{formatRate(r.noShowRate)}</span>
                    <RateBar rate={r.noShowRate} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
            <tr>
              <th scope="row" className="px-4 py-3 text-slate-900">Total</th>
              <td className="px-3 py-3 text-right tabular-nums">{totals.attended}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.cancelled}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.noShow}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-right tabular-nums">{formatRate(totals.noShowRate)}</span>
                  <RateBar rate={totals.noShowRate} />
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
