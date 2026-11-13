import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/lib/auth';
import { splitMismatchFlag } from '@/lib/patient-note';
import { listPendingRequests } from '@/lib/queries/requests';
import { formatContact } from '@/lib/rules';
import { formatDateHuman, formatTime12 } from '@/lib/time';
import { formatDateTimeHuman } from '@/components/format';
import { Card, PageHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { AutoRefresh } from '@/components/staff/AutoRefresh';
import { DetailsDifferFlag } from '@/components/staff/DetailsDifferFlag';
import { AlertIcon, ChevronRight, ClockIcon, InboxIcon, MailIcon, PhoneIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Requests' };

/** Pending online requests, oldest first (FR2). */
export default async function RequestsPage() {
  await requireStaffPage('/requests');
  const requests = await listPendingRequests();
  const passed = requests.filter((r) => r.startPassed).length;

  return (
    <>
      <AutoRefresh />
      <PageHeader
        title="Pending requests"
        description={
          requests.length
            ? `${requests.length} online request${requests.length === 1 ? '' : 's'} waiting${passed ? ` (${passed} already past ${passed === 1 ? 'its' : 'their'} time; decline ${passed === 1 ? 'it' : 'them'} to clear the badge)` : ''}. Oldest first; open one to pick a chair and confirm, or decline. Reschedule requests are approved first come, first served: the first one confirmed for a time wins.`
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
        <ul className="motion-stagger flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.appointmentId}>
              <Link
                href={`/appointments/${r.appointmentId}`}
                className={cx(
                  'group flex items-stretch gap-4 rounded-lg border bg-white p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/30',
                  r.startPassed ? 'border-red-200' : 'border-rule',
                )}
              >
                <div className="hidden w-28 shrink-0 flex-col justify-center rounded-md bg-amber-50 px-3 py-2 text-center ring-1 ring-amber-200 sm:flex">
                  <span className="text-xs font-medium text-amber-900">{formatDateHuman(r.date).replace(/, \d{4}$/, '')}</span>
                  <span className="text-lg font-semibold text-amber-950 tabular-nums">{formatTime12(r.start)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="text-base font-semibold text-ink">{r.patientName}</p>
                    <p className="text-sm text-ink-muted">
                      {r.serviceName} · {r.dentistName}
                    </p>
                    {r.rescheduleOf && (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                        Reschedule request
                      </span>
                    )}
                  </div>
                  {r.rescheduleOf && (
                    <p className="mt-1 text-sm text-ink-muted">
                      Currently: {formatDateHuman(r.rescheduleOf.date)}, {formatTime12(r.rescheduleOf.start)}
                      {r.queuePosition != null && (
                        <>
                          {' · '}
                          <span className="font-medium text-ink">
                            {r.queuePosition > 1 ? `#${r.queuePosition} in line for this time (first approved wins)` : 'First in line'}
                          </span>
                        </>
                      )}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-medium text-ink sm:hidden">
                    {formatDateHuman(r.date)}, {formatTime12(r.start)}
                  </p>
                  <p className="mt-0.5 hidden text-sm text-ink sm:block">
                    Requested time: {formatDateHuman(r.date)}, {formatTime12(r.start)} – {formatTime12(r.end)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <PhoneIcon className="size-4 text-line-strong" />
                      {formatContact(r.contactNumber)}
                    </span>
                    {r.email && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <MailIcon className="size-4 shrink-0 text-line-strong" />
                        <span className="truncate">{r.email}</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <ClockIcon className="size-4 text-line-strong" />
                      Sent {formatDateTimeHuman(r.requestedAt)}
                    </span>
                  </div>
                  {(() => {
                    const { flag, note } = splitMismatchFlag(r.patientNote);
                    return (
                      <>
                        {flag && <DetailsDifferFlag flag={flag} className="mt-2.5" />}
                        {note && (
                          <p className="mt-2.5 rounded-md bg-canvas px-3 py-2 text-sm whitespace-pre-wrap text-ink ring-1 ring-rule">
                            <span className="font-medium text-ink">Patient note: </span>
                            {note}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {r.startPassed && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700">
                      <AlertIcon className="size-4" /> This time has passed; it can only be declined.
                    </p>
                  )}
                </div>
                <ChevronRight className="size-5 shrink-0 self-center text-line-strong group-hover:text-brand-700" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
