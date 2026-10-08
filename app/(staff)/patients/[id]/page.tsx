import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaffPage } from '@/lib/auth';
import { getPatient, getPatientHistory } from '@/lib/queries/patients';
import { formatContact } from '@/lib/rules';
import { formatDateHuman, formatTime12, todayManila } from '@/lib/time';
import { idSchema } from '@/lib/validation';
import { ageOn } from '@/components/format';
import { ChannelBadge, StatusBadge } from '@/components/ui/Badges';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ArrowLeft, CalendarIcon, PlusIcon } from '@/components/ui/icons';
import PatientProfileForm from './PatientProfileForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Patient #${id}` };
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  await requireStaffPage(`/patients/${raw}`);
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) notFound();
  const [patient, history] = await Promise.all([getPatient(parsed.data), getPatientHistory(parsed.data)]);
  if (!patient) notFound();
  const today = todayManila();
  const count = (s: string) => history.filter((h) => h.status === s).length;

  return (
    <>
      <Link href="/patients" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" /> Patients
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{patient.fullName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {formatContact(patient.contactNumber)} · {ageOn(patient.birthdate, today)} yrs · Patient #{patient.patientId}
          </p>
        </div>
        <ButtonLink href={`/appointments/new?patientId=${patient.patientId}`} variant="primary">
          <PlusIcon className="size-4" /> Book for this patient
        </ButtonLink>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Appointments" value={history.length} />
        <Stat label="Attended" value={count('attended')} />
        <Stat label="No-shows" value={count('no-show')} tone={count('no-show') >= 2 ? 'red' : undefined} />
        <Stat label="Cancelled" value={count('cancelled')} />
      </div>

      <PatientProfileForm patient={patient} today={today} />

      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Appointment history" description="Newest first, with the dentist's notes." />
        {history.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="No appointments yet" description="Bookings for this patient will be listed here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Appointment history for {patient.fullName}</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Date</th>
                  <th scope="col" className="px-4 py-3">Service</th>
                  <th scope="col" className="px-4 py-3">Dentist</th>
                  <th scope="col" className="px-4 py-3">Chair</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Channel</th>
                  <th scope="col" className="px-4 py-3">Dentist note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {history.map((h) => (
                  <tr key={h.appointmentId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/appointments/${h.appointmentId}`} className="font-semibold text-brand-800 hover:underline">
                        {formatDateHuman(h.date)}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {formatTime12(h.start)} – {formatTime12(h.end)}
                      </span>
                      {h.rescheduledFromId && <span className="block text-xs text-slate-500">Rescheduled from #{h.rescheduledFromId}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{h.serviceName}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-800">{h.dentistName}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{h.chairName ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={h.status} />
                    </td>
                    <td className="px-4 py-3">
                      <ChannelBadge channel={h.channel} />
                    </td>
                    <td className="max-w-72 px-4 py-3 whitespace-pre-wrap text-slate-700">
                      {h.dentistNote || <span className="text-slate-400">—</span>}
                      {h.patientNote && <span className="mt-1 block text-xs text-slate-500">Patient: {h.patientNote}</span>}
                    </td>
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

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${tone === 'red' ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
