import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaffPage } from '@/lib/auth';
import { getAppointmentDetail } from '@/lib/queries/appointments';
import { listDentistsWithSchedules } from '@/lib/queries/setup';
import { formatContact } from '@/lib/rules';
import { DAYS_OF_WEEK } from '@/lib/rules';
import { dayOfWeek, formatDateHuman, formatTime12, todayManila } from '@/lib/time';
import { idSchema } from '@/lib/validation';
import { ageOn, formatDateTimeHuman } from '@/components/format';
import { ChannelBadge, StatusBadge } from '@/components/ui/Badges';
import { Card, CardHeader } from '@/components/ui/Card';
import { ArrowLeft, CheckIcon } from '@/components/ui/icons';
import AppointmentActions from './AppointmentActions';
import DentistNoteForm from './DentistNoteForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Appointment #${id}` };
}

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  await requireStaffPage(`/appointments/${raw}`);
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) notFound();
  const [a, dentists] = await Promise.all([getAppointmentDetail(parsed.data), listDentistsWithSchedules()]);
  if (!a) notFound();
  const today = todayManila();

  return (
    <>
      <Link href={a.status === 'pending' ? '/requests' : `/dashboard?date=${a.date}`} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" /> {a.status === 'pending' ? 'Requests' : 'Schedule'}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Appointment #{a.appointmentId}</h1>
        <StatusBadge status={a.status} className="text-sm" />
        <ChannelBadge channel={a.channel} />
      </div>

      {(a.rescheduledFromId || a.replacedById) && (
        <div className="mb-5 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          {a.rescheduledFromId && (
            <p>
              Rescheduled from{' '}
              <Link href={`/appointments/${a.rescheduledFromId}`} className="font-semibold underline">
                #{a.rescheduledFromId}
              </Link>
            </p>
          )}
          {a.replacedById && (
            <p>
              Replaced by{' '}
              <Link href={`/appointments/${a.replacedById}`} className="font-semibold underline">
                #{a.replacedById}
              </Link>{' '}
              (this one was cancelled by the reschedule)
            </p>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Visit" />
            <dl className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <Item label="Date">
                {DAYS_OF_WEEK[dayOfWeek(a.date)]}, {formatDateHuman(a.date)}
              </Item>
              <Item label="Time">
                {formatTime12(a.start)} – {formatTime12(a.end)}
              </Item>
              <Item label="Service">
                {a.service.name} <span className="text-slate-500">({a.service.durationMinutes} min)</span>
              </Item>
              <Item label="Dentist">{a.dentist.name}</Item>
              <Item label="Chair">{a.chair ? a.chair.name : <span className="text-slate-500">Not assigned yet</span>}</Item>
              <Item label="Channel">
                <ChannelBadge channel={a.channel} />
              </Item>
              <Item label={a.channel === 'online' ? 'Requested' : 'Booked'}>{formatDateTimeHuman(a.requestedAt)}</Item>
              <Item label="Reminder">
                {a.reminderSentAt ? (
                  <span className="inline-flex items-center gap-1.5 text-green-800">
                    <CheckIcon className="size-4" /> Reminder sent {formatDateTimeHuman(a.reminderSentAt)}
                  </span>
                ) : a.status === 'scheduled' ? (
                  <span className="text-slate-500">Sent automatically the day before</span>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </Item>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Patient"
              actions={
                <Link href={`/patients/${a.patient.id}`} className="text-sm font-semibold text-brand-800 underline-offset-2 hover:underline">
                  View record and history
                </Link>
              }
            />
            <dl className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <Item label="Name">
                <Link href={`/patients/${a.patient.id}`} className="font-semibold text-brand-800 hover:underline">
                  {a.patient.name}
                </Link>
              </Item>
              <Item label="Contact number">
                <a href={`tel:${a.patient.contact}`} className="tabular-nums hover:underline">
                  {formatContact(a.patient.contact)}
                </a>
              </Item>
              <Item label="Email">{a.patient.email ?? <span className="text-slate-500">None on file</span>}</Item>
              <Item label="Birthdate">
                {formatDateHuman(a.patient.birthdate)} <span className="text-slate-500">({ageOn(a.patient.birthdate, today)} yrs)</span>
              </Item>
            </dl>
            <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
              <p className="text-sm font-medium text-slate-500">Patient note</p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-slate-900">{a.patientNote || <span className="text-slate-500">No note</span>}</p>
            </div>
          </Card>

          <DentistNoteForm appointmentId={a.appointmentId} initialNote={a.dentistNote ?? ''} />
        </div>

        <div className="min-w-0">
          <AppointmentActions
            appointment={{
              id: a.appointmentId,
              status: a.status,
              date: a.date,
              start: a.start,
              end: a.end,
              startPassed: a.startPassed,
              allowedTransitions: a.allowedTransitions,
              patientId: a.patient.id,
              patientName: a.patient.name,
              patientEmail: a.patient.email,
              serviceId: a.service.id,
              dentistId: a.dentist.id,
              chairId: a.chair?.id ?? null,
            }}
            dentists={dentists.map((d) => ({ id: d.dentistId, name: d.dentistName }))}
            today={today}
          />
        </div>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-slate-900">{children}</dd>
    </div>
  );
}
