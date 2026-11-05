import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { listDentistsWithSchedules, listServices } from '@/lib/queries/setup';
import { addDays, dayOfWeek, isValidDate, isValidTime, todayManila } from '@/lib/time';
import { BrandLockup } from '@/components/ui/BrandLogo';
import { InfoIcon, PhoneIcon } from '@/components/ui/icons';
import BookShell from './BookShell';
import BookingForm, { type BookPrefill } from './BookingForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Book an appointment' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f766e', interactiveWidget: 'resizes-content' };

const DEMO_BANNER = 'Demo system: please use sample details, not your real information.';

/** Public online request form (FR1). Mobile-first; must work at 360 px (NF01). */
export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const clinicPhone = process.env.CLINIC_PHONE || undefined;
  const [services, dentists] = await Promise.all([listServices(), listDentistsWithSchedules()]);
  const today = todayManila();
  const sp = await searchParams;
  const prefill = parsePrefill(sp, {
    serviceIds: services.map((s) => s.serviceId),
    dentists: dentists.map((d) => ({ id: d.dentistId, days: d.schedules.map((x) => x.dayOfWeek) })),
    today,
    maxDate: addDays(today, 60),
  });

  return (
    <BookShell>
      <header className="shrink-0 border-b border-rule bg-white">
        <p role="note" className="border-b border-rule bg-brand-50 px-4 py-2">
          <span className="mx-auto flex max-w-5xl items-start gap-2 text-[13px] leading-snug font-medium text-ink">
            <InfoIcon className="mt-px size-4 shrink-0 text-accent-700" />
            <span>{DEMO_BANNER}</span>
          </span>
        </p>
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <BrandLockup className="h-11 shrink-0" />
          <h1 className="min-w-0 border-l border-rule pl-3 text-sm leading-snug font-normal text-ink-muted">Request an appointment online</h1>
          {clinicPhone && (
            <a href={`tel:${clinicPhone.replace(/[^+\d]/g, '')}`} className="ml-auto hidden h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink hover:bg-brand-50 sm:inline-flex">
              <PhoneIcon className="size-4 text-ink-muted" />
              {clinicPhone}
            </a>
          )}
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <BookingForm
          services={services.map((s) => ({ id: s.serviceId, name: s.serviceName, durationMinutes: s.durationMinutes }))}
          dentists={dentists.map((d) => ({ id: d.dentistId, name: d.dentistName, workingDays: d.schedules.map((s) => s.dayOfWeek) }))}
          today={today}
          maxDate={addDays(today, 60)}
          clinicPhone={clinicPhone}
          prefill={prefill}
          footer={
            <p className="mt-8 text-center text-xs text-ink-muted">
              <Link href="/login" className="inline-block py-1 text-ink-muted underline">
                Clinic staff login
              </Link>
            </p>
          }
        />
      </main>
    </BookShell>
  );
}

/**
 * Messenger bot link: /book?service=1&dentist=any&date=2026-11-09&time=10:00&ref=<token>.
 * Every value is checked against real data; anything that does not check out is dropped, so the
 * form just opens at the first step. `ref` is only passed along; /api/requests verifies it.
 */
function parsePrefill(
  sp: Record<string, string | string[] | undefined>,
  ctx: { serviceIds: number[]; dentists: { id: number; days: number[] }[]; today: string; maxDate: string },
): BookPrefill | undefined {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const serviceId = /^\d{1,9}$/.test(one('service')) && ctx.serviceIds.includes(Number(one('service'))) ? Number(one('service')) : undefined;
  if (!serviceId) return undefined;
  const dentistRaw = one('dentist');
  const dentist = dentistRaw === 'any' ? 'any' : /^\d{1,9}$/.test(dentistRaw) && ctx.dentists.some((d) => d.id === Number(dentistRaw)) ? Number(dentistRaw) : 'any';
  const date = one('date');
  const time = one('time');
  const dateOk = isValidDate(date) && date >= ctx.today && date <= ctx.maxDate && (dentist === 'any' ? ctx.dentists : ctx.dentists.filter((d) => d.id === dentist)).some((d) => d.days.includes(dayOfWeek(date)));
  const ref = one('ref').slice(0, 200);
  return {
    serviceId,
    dentistId: dentist,
    date: dateOk ? date : undefined,
    start: dateOk && /^\d{2}:\d{2}$/.test(time) && isValidTime(time) ? time : undefined,
    chatRef: ref || undefined,
  };
}
