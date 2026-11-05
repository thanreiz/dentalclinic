import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/lib/auth';
import { searchPatients } from '@/lib/queries/patients';
import { formatContact } from '@/lib/rules';
import { formatDateHuman } from '@/lib/time';
import { buttonClasses, ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChevronLeft, ChevronRight, PlusIcon, UsersIcon } from '@/components/ui/icons';
import PatientSearchBox from './PatientSearchBox';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Patients' };

const PAGE_SIZE = 20;

export default async function PatientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('/patients');
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100);
  const pageRaw = typeof sp.page === 'string' ? Number(sp.page) : 1;
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const { rows, total } = await searchPatients(q, page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/patients?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Patients"
        description="One record per patient, matched by contact number."
        actions={
          <ButtonLink href="/appointments/new" variant="primary">
            <PlusIcon className="size-4" /> New booking
          </ButtonLink>
        }
      />
      <div className="mb-4 max-w-xl">
        <PatientSearchBox initial={q} />
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={q ? 'No matching patients' : 'No patients yet'}
            description={q ? `Nothing matches “${q}”. Try part of the name or the last digits of the number.` : 'Patients are added by online requests and staff bookings.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Patients{q ? ` matching ${q}` : ''}</caption>
                <thead className="border-b border-rule text-[13px] font-medium text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 whitespace-nowrap">Name</th>
                    <th scope="col" className="px-4 py-3 whitespace-nowrap">Contact number</th>
                    <th scope="col" className="hidden px-4 py-3 lg:table-cell">Email</th>
                    <th scope="col" className="hidden px-4 py-3 xl:table-cell">Birthdate</th>
                    <th scope="col" className="hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">Visits</th>
                    <th scope="col" className="hidden px-4 py-3 whitespace-nowrap sm:table-cell">Last attended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((p) => (
                    <tr key={p.patientId} className="hover:bg-brand-50/50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href={`/patients/${p.patientId}`} className="font-semibold text-brand-800 hover:underline">
                          {p.fullName}
                        </Link>
                        <span className="block text-xs font-normal text-ink-muted sm:hidden">
                          {p.appointmentCount} visit{p.appointmentCount === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-ink">{formatContact(p.contactNumber)}</td>
                      <td className="hidden max-w-56 truncate px-4 py-3 text-ink lg:table-cell">{p.email ?? <span className="text-line-strong">—</span>}</td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-ink xl:table-cell">{formatDateHuman(p.birthdate)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-ink sm:table-cell">{p.appointmentCount}</td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-ink sm:table-cell">
                        {p.lastVisitDate ? formatDateHuman(p.lastVisitDate) : <span className="text-line-strong">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="flex items-center justify-between gap-3 border-t border-rule px-4 py-3 text-sm" aria-label="Pagination">
              <p className="text-ink-muted">
                {total} patient{total === 1 ? '' : 's'} · page {Math.min(page, pages)} of {pages}
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
