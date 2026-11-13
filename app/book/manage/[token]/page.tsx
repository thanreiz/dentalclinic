import type { Metadata, Viewport } from 'next';
import { queryOne } from '@/lib/db';
import { verifyManageToken } from '@/lib/manage-link';
import { listPublicDentists } from '@/lib/queries/setup';
import { PATIENT_RESCHEDULE_WINDOW_DAYS, pendingRescheduleFor } from '@/lib/services/appointments';
import { hasStarted } from '@/lib/rules';
import { addDays, todayManila, toHHMM } from '@/lib/time';
import { BrandLockup } from '@/components/ui/BrandLogo';
import BookShell from '../../BookShell';
import ManageAppointment from './ManageAppointment';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your appointment', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f766e' };

type Row = {
  appointment_id: number;
  status: string;
  appointment_date: string;
  start_time: string;
  dentist_id: number;
  service_id: number;
  full_name: string;
  dentist_name: string;
  service_name: string;
  duration_minutes: number;
};

/** Patient self-service page opened from the link in their confirmation / reminder (panel feedback). */
export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyManageToken(token);
  const row = id
    ? await queryOne<Row>(
        `SELECT a.appointment_id, a.status, a.appointment_date, a.start_time, a.dentist_id, a.service_id,
                p.full_name, d.dentist_name, s.service_name, s.duration_minutes
           FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
           JOIN dentists d ON d.dentist_id = a.dentist_id JOIN services s ON s.service_id = a.service_id
          WHERE a.appointment_id = ?`,
        [id],
      )
    : null;
  const clinicPhone = process.env.CLINIC_PHONE || undefined;
  const today = todayManila();
  const usable = row && row.status === 'scheduled' && !hasStarted(row.appointment_date, row.start_time);
  const [dentists, pending] = usable && row ? await Promise.all([listPublicDentists(), pendingRescheduleFor(row.appointment_id)]) : [[], null];
  const workingDays = dentists.find((d) => d.dentistId === row?.dentist_id)?.schedules.map((s) => s.dayOfWeek) ?? [];

  return (
    <BookShell>
      <header className="shrink-0 border-b border-rule bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <BrandLockup className="h-11 shrink-0" />
          <h1 className="min-w-0 border-l border-rule pl-3 text-sm leading-snug font-normal text-ink-muted">Your appointment</h1>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {usable && row ? (
          <ManageAppointment
            token={token}
            pending={pending ? { date: pending.date, start: pending.start, position: pending.position } : null}
            appt={{
              patientFirstName: row.full_name.trim().split(/\s+/)[0] ?? '',
              date: row.appointment_date,
              start: toHHMM(row.start_time),
              dentistId: row.dentist_id,
              dentistName: row.dentist_name,
              serviceId: row.service_id,
              serviceName: row.service_name,
            }}
            workingDays={workingDays}
            today={today}
            maxDate={addDays(today, PATIENT_RESCHEDULE_WINDOW_DAYS)}
            clinicPhone={clinicPhone}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-10">
            <h2 className="text-2xl font-bold tracking-tight text-ink">This link can no longer be used</h2>
            <p className="mt-2 text-ink-muted">
              The appointment may have already been moved, cancelled, or passed. Please check your latest email or message from the clinic
              {clinicPhone ? `, or call ${clinicPhone}` : ''}.
            </p>
          </div>
        )}
      </main>
    </BookShell>
  );
}
