import type { Metadata } from 'next';
import { requireStaffPage } from '@/lib/auth';
import { getPatient } from '@/lib/queries/patients';
import { listChairs, listDentistsWithSchedules, listServices } from '@/lib/queries/setup';
import { STAFF_CHANNELS, type StaffChannel } from '@/lib/rules';
import { isValidDate, todayManila } from '@/lib/time';
import { PageHeader } from '@/components/ui/Card';
import NewBookingForm from './NewBookingForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New booking' };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const posInt = (v: string | undefined) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined);

/** Staff booking for phone, chat, and walk-in (FR3). Saves as scheduled with a chair. */
export default async function NewBookingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaffPage('/appointments/new');
  const sp = await searchParams;
  const today = todayManila();
  const patientId = posInt(one(sp.patientId));
  const [services, dentists, chairs, patient] = await Promise.all([
    listServices(),
    listDentistsWithSchedules(),
    listChairs(),
    patientId ? getPatient(patientId) : Promise.resolve(null),
  ]);

  const date = one(sp.date);
  const start = one(sp.start);
  const channel = one(sp.channel);
  const serviceId = posInt(one(sp.serviceId));
  const dentistId = posInt(one(sp.dentistId));

  return (
    <>
      <PageHeader title="New booking" description="Phone, chat, or walk-in. Saved as scheduled with a chair; no confirmation email is sent." />
      <NewBookingForm
        today={today}
        services={services.map((s) => ({ id: s.serviceId, name: s.serviceName, durationMinutes: s.durationMinutes }))}
        dentists={dentists.map((d) => ({ id: d.dentistId, name: d.dentistName, workingDays: d.schedules.map((x) => x.dayOfWeek) }))}
        chairCount={chairs.length}
        initial={{
          patient: patient
            ? { patientId: patient.patientId, fullName: patient.fullName, contactNumber: patient.contactNumber, email: patient.email, birthdate: patient.birthdate }
            : null,
          serviceId: services.some((s) => s.serviceId === serviceId) ? serviceId : undefined,
          dentistId: dentists.some((d) => d.dentistId === dentistId) ? dentistId : undefined,
          date: date && isValidDate(date) && date >= today ? date : undefined,
          start: start && /^\d{2}:\d{2}$/.test(start) ? start : undefined,
          channel: (STAFF_CHANNELS as readonly string[]).includes(channel ?? '') ? (channel as StaffChannel) : undefined,
        }}
      />
    </>
  );
}
