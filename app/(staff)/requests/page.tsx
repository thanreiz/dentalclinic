import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/lib/auth';
import { listPendingRequests } from '@/lib/queries/requests';
import { formatContact } from '@/lib/rules';
import { formatDateHuman, formatTime12 } from '@/lib/time';
import { formatDateTimeHuman } from '@/components/format';
import { Card, PageHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertIcon, ChevronRight, ClockIcon, InboxIcon, MailIcon, PhoneIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Requests' };

/** Pending online requests, oldest first (FR2). */
export default async function RequestsPage() {
  await requireStaffPage('/requests');
  const requests = await listPendingRequests();

  return (
    <>
      <PageHeader
        title="Pending requests"
        description={
          requests.length
            ? `${requests.length} online request${requests.length === 1 ? '' : 's'} waiting. Oldest first; open one to pick a chair and confirm, or decline.`
            : 'Online requests from the booking form show up here.'
        }
      />
      {requests.length === 0 ? (
        <Card>
          <EmptyState
            icon={<InboxIcon />}
            title="No pending requests"
            description="When a patient submits the online form, the request waits here until you confirm or decline it."
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.appointmentId}>
              <Link
                href={`/appointments/${r.appointmentId}`}
                className={cx(
                  'group flex items-stretch gap-4 rounded-lg border bg-white p-4 shadow-xs transition-colors hover:border-brand-300 hover:bg-brand-50/30',
                  r.startPassed ? 'border-red-200' : 'border-slate-200',
                )}
              >
                <div className="hidden w-28 shrink-0 flex-col justify-center rounded-md bg-amber-50 px-3 py-2 text-center ring-1 ring-amber-200 sm:flex">
                  <span className="text-xs font-medium text-amber-900">{formatDateHuman(r.date).replace(/, \d{4}$/, '')}</span>
                  <span className="text-lg font-semibold text-amber-950 tabular-nums">{formatTime12(r.start)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="text-base font-semibold text-slate-900">{r.patientName}</p>
                    <p className="text-sm text-slate-600">
                      {r.serviceName} · {r.dentistName}
                    </p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800 sm:hidden">
                    {formatDateHuman(r.date)}, {formatTime12(r.start)}
                  </p>
                  <p className="mt-0.5 hidden text-sm text-slate-700 sm:block">
                    Requested time: {formatDateHuman(r.date)}, {formatTime12(r.start)} – {formatTime12(r.end)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <PhoneIcon className="size-4 text-slate-400" />
                      {formatContact(r.contactNumber)}
                    </span>
                    {r.email && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <MailIcon className="size-4 shrink-0 text-slate-400" />
                        <span className="truncate">{r.email}</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <ClockIcon className="size-4 text-slate-400" />
                      Sent {formatDateTimeHuman(r.requestedAt)}
                    </span>
                  </div>
                  {r.patientNote && (
                    <p className="mt-2.5 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                      <span className="font-medium text-slate-900">Patient note: </span>
                      {r.patientNote}
                    </p>
                  )}
                  {r.startPassed && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700">
                      <AlertIcon className="size-4" /> This time has passed; it can only be declined.
                    </p>
                  )}
                </div>
                <ChevronRight className="size-5 shrink-0 self-center text-slate-400 group-hover:text-brand-700" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
