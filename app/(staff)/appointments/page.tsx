import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/lib/auth';
import { listAppointments } from '@/lib/queries/appointments';
import { APPOINTMENT_STATUSES, CHANNELS, formatContact } from '@/lib/rules';
import { formatDateHuman, formatTime12 } from '@/lib/time';
import { parseAppointmentFilters } from '@/lib/validation';
import { ChannelBadge, StatusBadge, STATUS_STYLES } from '@/components/ui/Badges';
import { buttonClasses, ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChevronLeft, ChevronRight, ListIcon, PlusIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'All appointments' };

const PAGE_SIZE = 50;
const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = { online: 'Online', phone: 'Phone', chat: 'Chat', 'walk-in': 'Walk-in' };

const controlClass =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/40 focus:outline-none';

/** Every appointment from every channel in one list (SOP 1: centralized bookings). */
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('/appointments');
  const sp = await searchParams;
  const { filters, page } = parseAppointmentFilters(sp);
  const { rows, total } = await listAppointments(filters, page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = Object.values(filters).some(Boolean);
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    qs.set('page', String(p));
    return `/appointments?${qs}`;
  };

  return (
    <>
      <PageHeader
        title="All appointments"
        description="Online requests, phone, chat and walk-in bookings in one list."
        actions={
          <ButtonLink href="/appointments/new" variant="primary">
            <PlusIcon className="size-4" /> New booking
          </ButtonLink>
        }
      />

      <form method="get" action="/appointments" className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-6">
        <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-slate-700 lg:col-span-2">
          Patient name or number
          <input type="search" name="q" defaultValue={filters.q ?? ''} maxLength={100} placeholder="e.g. Maria or 917 555" className={controlClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Channel
          <select name="channel" defaultValue={filters.channel ?? ''} className={controlClass}>
            <option value="">All channels</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Status
          <select name="status" defaultValue={filters.status ?? ''} className={controlClass}>
            <option value="">All statuses</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_STYLES[s].label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          From
          <input type="date" name="from" defaultValue={filters.from ?? ''} className={controlClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          To
          <input type="date" name="to" defaultValue={filters.to ?? ''} className={controlClass} />
        </label>
        <div className="col-span-2 flex gap-2 lg:col-span-6">
          <button type="submit" className={buttonClasses('primary', 'sm')}>Apply filters</button>
          {hasFilter && (
            <Link href="/appointments" className={buttonClasses('secondary', 'sm')}>Clear</Link>
          )}
        </div>
      </form>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<ListIcon />}
            title={hasFilter ? 'No appointments match these filters' : 'No appointments yet'}
            description={hasFilter ? 'Try a wider date range or clear the filters.' : 'Online requests and staff bookings appear here.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Appointments from all channels</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3">Date and time</th>
                    <th scope="col" className="px-4 py-3">Patient</th>
                    <th scope="col" className="hidden px-4 py-3 lg:table-cell">Service</th>
                    <th scope="col" className="hidden px-4 py-3 md:table-cell">Dentist</th>
                    <th scope="col" className="px-4 py-3">Channel</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((a) => (
                    <tr key={a.appointmentId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href={`/appointments/${a.appointmentId}`} className="font-semibold text-brand-800 hover:underline">
                          {formatDateHuman(a.date)}
                        </Link>
                        <span className="block text-xs text-slate-600">{formatTime12(a.start)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/patients/${a.patientId}`} className="font-medium text-slate-900 hover:underline">{a.patientName}</Link>
                        <span className="block text-xs whitespace-nowrap tabular-nums text-slate-600">{formatContact(a.contactNumber)}</span>
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">{a.serviceName}</td>
                      <td className="hidden px-4 py-3 text-slate-700 md:table-cell">{a.dentistName}</td>
                      <td className="px-4 py-3"><ChannelBadge channel={a.channel} /></td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm" aria-label="Pagination">
              <p className="text-slate-600">
                {total} appointment{total === 1 ? '' : 's'} · page {Math.min(page, pages)} of {pages}
              </p>
              <div className="flex gap-2">
                <Link
                  href={href(page - 1)}
                  aria-disabled={page <= 1}
                  tabIndex={page <= 1 ? -1 : undefined}
                  className={cx(buttonClasses('secondary', 'sm'), page <= 1 && 'pointer-events-none opacity-50')}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Link>
                <Link
                  href={href(page + 1)}
                  aria-disabled={page >= pages}
                  tabIndex={page >= pages ? -1 : undefined}
                  className={cx(buttonClasses('secondary', 'sm'), page >= pages && 'pointer-events-none opacity-50')}
                >
                  Next <ChevronRight className="size-4" />
                </Link>
              </div>
            </nav>
          </>
        )}
      </Card>
    </>
  );
}
