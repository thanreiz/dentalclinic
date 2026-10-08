import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { listDentistsWithSchedules, listServices } from '@/lib/queries/setup';
import { addDays, todayManila } from '@/lib/time';
import { InfoIcon, ToothIcon } from '@/components/ui/icons';
import BookingForm from './BookingForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Book an appointment' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f766e' };

const DEMO_BANNER = 'Demo system: please use sample details, not your real information.';

/** Public online request form (FR1). Mobile-first; must work at 360 px (NF01). */
export default async function BookPage() {
  const clinicName = process.env.CLINIC_NAME || 'Sample Dental Clinic';
  const clinicPhone = process.env.CLINIC_PHONE || undefined;
  const [services, dentists] = await Promise.all([listServices(), listDentistsWithSchedules()]);
  const today = todayManila();

  return (
    <div className="min-h-dvh bg-canvas">
      <div role="note" className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-amber-950">
        <p className="mx-auto flex max-w-lg items-start gap-2 text-sm font-medium">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>{DEMO_BANNER}</span>
        </p>
      </div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-700 text-white">
            <ToothIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">{clinicName}</p>
            <p className="text-sm text-slate-600">Request an appointment online</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 pt-5 pb-12">
        <BookingForm
          services={services.map((s) => ({ id: s.serviceId, name: s.serviceName, durationMinutes: s.durationMinutes }))}
          dentists={dentists.map((d) => ({ id: d.dentistId, name: d.dentistName, workingDays: d.schedules.map((s) => s.dayOfWeek) }))}
          today={today}
          maxDate={addDays(today, 60)}
          clinicPhone={clinicPhone}
        />
        <p className="mt-8 text-center text-xs text-slate-500">
          No account needed. Your request is reviewed by clinic staff before it is confirmed.
          <br />
          <Link href="/login" className="mt-2 inline-block py-1 text-slate-600 underline">
            Clinic staff login
          </Link>
        </p>
      </main>
    </div>
  );
}
