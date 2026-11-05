'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/components/api';
import { DateCalendar } from '@/components/booking/DateCalendar';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { Checkbox, FormError, Input, Textarea } from '@/components/ui/Field';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { BrandIcon } from '@/components/ui/BrandLogo';
import { AlertIcon, CalendarIcon, CheckIcon, ClockIcon, PhoneIcon, SearchIcon } from '@/components/ui/icons';
import { dayOfWeek, formatDateHuman, formatTime12 } from '@/lib/time';
import type { Slot } from '@/lib/types';
import { bookingRequestSchema, fieldErrors, stripNameChars } from '@/lib/validation';

export type BookService = { id: number; name: string; durationMinutes: number };
export type BookDentist = { id: number; name: string; workingDays: number[] };

/** Opened from the Messenger bot: choices already made, plus the signed token that marks channel 'chat'. */
export type BookPrefill = { serviceId: number; dentistId: number | 'any'; date?: string; start?: string; chatRef?: string };

type Props = {
  prefill?: BookPrefill;
  services: BookService[];
  dentists: BookDentist[];
  today: string;
  maxDate: string;
  clinicPhone?: string;
};

type Step = 1 | 2 | 3 | 'done';
type Details = { fullName: string; contactNumber: string; email: string; birthdate: string; patientNote: string };
type DetailKey = keyof Details;

const CONSENT_TEXT =
  'I consent to the clinic collecting and processing my personal information for appointment scheduling, in line with the Data Privacy Act of 2012 (RA 10173).';
const TAKEN_TEXT = 'That time was just taken. Please pick another time.';
const EMPTY_DETAILS: Details = { fullName: '', contactNumber: '', email: '', birthdate: '', patientNote: '' };

const STEPS = [
  { n: 1, label: 'Visit' },
  { n: 2, label: 'Date & time' },
  { n: 3, label: 'Details' },
] as const;

/** Services have no category in the data, so group by name; anything unmatched lands in "Other services". */
const SERVICE_GROUPS: { label: string; test: RegExp }[] = [
  { label: 'Braces', test: /braces/i },
  { label: 'Extractions & surgery', test: /extract|wisdom/i },
  { label: 'Fillings & restorations', test: /fill|root canal|crown|implant/i },
  { label: 'Check-ups & cleaning', test: /prophylaxis|exam|x-ray|whiten|clean|check/i },
];
const GROUP_ORDER = ['Check-ups & cleaning', 'Fillings & restorations', 'Extractions & surgery', 'Braces', 'Other services'];
const eyebrow = 'text-[13px] font-medium text-ink-muted';
const h2Class = 'text-2xl leading-8 font-bold tracking-tight text-ink outline-none';

function groupServices(list: BookService[]): { label: string; items: BookService[] }[] {
  const map = new Map<string, BookService[]>();
  for (const s of list) {
    const label = SERVICE_GROUPS.find((g) => g.test.test(s.name))?.label ?? 'Other services';
    map.set(label, [...(map.get(label) ?? []), s]);
  }
  return GROUP_ORDER.filter((l) => map.has(l)).map((label) => ({ label, items: map.get(label)! }));
}

export default function BookingForm({ services, dentists, today, maxDate, clinicPhone, prefill }: Props) {
  const [step, setStep] = useState<Step>(prefill?.date && prefill.start ? 3 : 1);
  const [serviceId, setServiceId] = useState<number | null>(prefill?.serviceId ?? (services.length === 1 ? services[0].id : null));
  const [dentistId, setDentistId] = useState<number | 'any'>(prefill?.dentistId ?? 'any');
  const [date, setDate] = useState<string | null>(prefill?.date ?? null);
  const [start, setStart] = useState<string | null>(prefill?.start ?? null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsState, setSlotsState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [slotsReload, setSlotsReload] = useState(0);
  const [takenNotice, setTakenNotice] = useState(false);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const firstRender = useRef(true);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const groups = useMemo(() => groupServices(services.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))), [services, query]);
  const dentistLabel = dentistId === 'any' ? 'Any available dentist' : (dentists.find((d) => d.id === dentistId)?.name ?? '');

  const workingDays = useMemo(() => {
    const list = dentistId === 'any' ? dentists : dentists.filter((d) => d.id === dentistId);
    return new Set(list.flatMap((d) => d.workingDays));
  }, [dentists, dentistId]);

  // Move focus to the step heading on step change (screen readers + keyboard users).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  // Load open slots whenever service, dentist, or date changes (Rule 5 via GET /api/slots).
  useEffect(() => {
    if (!serviceId || !date) return;
    const ctrl = new AbortController();
    setSlotsState('loading');
    const qs = new URLSearchParams({ date, serviceId: String(serviceId), dentistId: String(dentistId) });
    api<{ slots: Slot[] }>(`/api/slots?${qs}`, { signal: ctrl.signal })
      .then((r) => {
        if (r.ok && Array.isArray(r.data.slots)) {
          setSlots(r.data.slots);
          setSlotsState('idle');
        } else {
          setSlots(null);
          setSlotsState('error');
        }
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [serviceId, dentistId, date, slotsReload]);

  function pickService(id: number) {
    setServiceId(id);
    setStart(null);
  }
  function pickDentist(id: number | 'any') {
    setDentistId(id);
    setStart(null);
    if (date && !(id === 'any' ? dentists : dentists.filter((d) => d.id === id)).some((d) => d.workingDays.includes(dayOfWeek(date)))) {
      setDate(null);
      setSlots(null);
    }
  }
  function pickDate(d: string) {
    setDate(d);
    setStart(null);
    setTakenNotice(false);
  }

  function setDetail(key: DetailKey, value: string) {
    setDetails((v) => ({ ...v, [key]: value }));
    // Once a field shows an error, re-check as the person types: the message clears the moment the value is
    // valid, not on blur (blur removed the message mid-tap and moved the submit button out from under a finger).
    if (errors[key]) {
      const r = bookingRequestSchema.shape[key].safeParse(value);
      setErrors((e) => {
        const next = { ...e };
        if (r.success) delete next[key];
        else next[key] = r.error.issues[0]?.message ?? 'Check this field';
        return next;
      });
    }
  }

  /** Validate one field on blur with the same Zod schema the API uses. */
  function validateField(key: DetailKey) {
    const value = details[key];
    if (!value && !errors[key]) return;
    const r = bookingRequestSchema.shape[key].safeParse(value);
    setErrors((e) => {
      const next = { ...e };
      if (r.success) delete next[key];
      else next[key] = r.error.issues[0]?.message ?? 'Check this field';
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = {
      serviceId,
      dentistId,
      date,
      start,
      fullName: details.fullName,
      contactNumber: details.contactNumber,
      email: details.email,
      birthdate: details.birthdate,
      patientNote: details.patientNote,
      consent,
      website: honeypotRef.current?.value ?? '',
      chatRef: prefill?.chatRef,
    };
    const { website, ...toCheck } = payload;
    // toCheck (validated and sent) includes chatRef; the server verifies the token itself.
    const parsed = bookingRequestSchema.safeParse(toCheck);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      setErrors(errs);
      if (errs.serviceId) setStep(1);
      else if (errs.date || errs.start) setStep(2);
      else focusFirstError(errs);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const r = await api<{ slots?: Slot[] }>('/api/requests', { body: { ...toCheck, website } });
    setSubmitting(false);
    if (r.ok) {
      setStep('done');
      return;
    }
    if (r.status === 409 && r.data.error === 'slot_taken') {
      setSlots(Array.isArray(r.data.slots) ? r.data.slots : []);
      setSlotsState('idle');
      setStart(null);
      setTakenNotice(true);
      setStep(2);
      return;
    }
    if (r.status === 409 && (r.data.error === 'duplicate_request' || r.data.error === 'link_used')) {
      // The patient already has a request for this time (also when the Messenger link is used twice).
      setFormError(
        (typeof r.data.message === 'string' && r.data.message) ||
          'You already have a request for that time. The clinic will confirm it, so there is no need to send it again.',
      );
      return;
    }
    if (r.status === 400 && r.data.issues && typeof r.data.issues === 'object') {
      const errs = r.data.issues as Record<string, string>;
      setErrors(errs);
      if (errs.serviceId || errs.dentistId) setStep(1);
      else if (errs.date || errs.start) setStep(2);
      else focusFirstError(errs);
      setFormError(r.data.message ?? 'Please check the highlighted fields.');
      return;
    }
    if (r.status === 429) {
      // too_many_requests: the server explains which limit was hit (pending requests on this number,
      // clinic busy, or this device) and how to reach the clinic.
      setFormError(
        (typeof r.data.message === 'string' && r.data.message) ||
          'Too many requests right now. Please wait a few minutes and try again, or call the clinic.',
      );
      return;
    }
    setFormError(
      r.status === 0
        ? 'Could not reach the clinic. Check your connection and try again.'
        : 'Something went wrong while sending your request. Please try again.',
    );
  }

  function focusFirstError(errs: Record<string, string>) {
    const order: string[] = ['fullName', 'contactNumber', 'email', 'birthdate', 'patientNote', 'consent'];
    const key = order.find((k) => errs[k]);
    if (key) requestAnimationFrame(() => document.getElementById(`book-${key}`)?.focus());
  }

  function resetAll() {
    setStep(1);
    setDate(null);
    setStart(null);
    setSlots(null);
    setDetails(EMPTY_DETAILS);
    setConsent(false);
    setErrors({});
    setTakenNotice(false);
  }

  if (step === 'done') {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-rule bg-white p-6 sm:p-8" role="status" aria-live="polite">
        <div className="flex items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-800">
            <CheckIcon className="size-6" />
          </div>
          <div>
            <h2 ref={headingRef} tabIndex={-1} className={h2Class}>
              Thank you
            </h2>
            <p className="mt-0.5 text-base text-ink">Request received. The clinic will email you once it is confirmed.</p>
          </div>
        </div>
        <dl className="mt-6 divide-y divide-rule rounded-xl border border-rule bg-canvas px-4 text-sm">
          <SummaryRow label="Service" value={service?.name ?? ''} />
          <SummaryRow label="Dentist" value={dentistLabel} />
          {date && start && <SummaryRow label="When" value={`${formatDateHuman(date)}, ${formatTime12(start)}`} />}
          <SummaryRow label="Email" value={details.email} />
        </dl>
        <h3 className="mt-6 text-sm font-semibold text-ink">What happens next</h3>
        <ol className="mt-3 space-y-3 text-sm text-ink">
          {['The clinic reviews your request.', 'You get an email once the time is confirmed.', 'You come in at your time. We send a reminder the day before.'].map((t, i) => (
            <li key={t} className="flex items-start gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-900" aria-hidden="true">
                {i + 1}
              </span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="lg" className="mt-6 w-full" onClick={resetAll}>
          Book another appointment
        </Button>
      </div>
    );
  }

  const when = date && start ? `${formatDateHuman(date)}, ${formatTime12(start)}` : null;
  const morning = (slots ?? []).filter((s) => s.start < '12:00');
  const afternoon = (slots ?? []).filter((s) => s.start >= '12:00');
  const slotButtons = (list: Slot[]) =>
    list.map((s) => {
      const checked = start === s.start;
      return (
        <label
          key={s.start}
          className={cx(
            'relative flex h-12 cursor-pointer items-center justify-center rounded-[10px] text-[15px] font-semibold tabular-nums transition-colors',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
            checked ? 'bg-brand-700 text-white' : 'bg-white text-ink ring-1 ring-line-strong hover:bg-brand-50 hover:ring-brand-500',
          )}
        >
          <input
            type="radio"
            name="slot"
            value={s.start}
            checked={checked}
            onChange={() => {
              setStart(s.start);
              setTakenNotice(false);
            }}
            className="sr-only"
          />
          {formatTime12(s.start)}
        </label>
      );
    });

  const actionBar = 'sticky bottom-0 z-10 -mx-4 border-t border-rule bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-none lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none';

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6">
        <ol className="flex items-center" aria-label="Booking steps">
          {STEPS.map(({ n, label }, i) => {
            const active = step === n;
            const done = typeof step === 'number' && step > n;
            return (
              <li key={n} aria-current={active ? 'step' : undefined} className={cx('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span
                    className={cx(
                      'grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums',
                      active ? 'bg-brand-700 text-white' : done ? 'bg-brand-100 text-brand-900' : 'bg-white text-ink-muted ring-1 ring-line-strong',
                    )}
                    aria-hidden="true"
                  >
                    {done ? <CheckIcon className="size-4" /> : n}
                  </span>
                  <span className={cx('text-sm', active ? 'font-semibold text-ink' : done ? 'font-medium text-ink' : 'text-ink-muted')}>
                    <span className="sr-only">Step {n}: </span>
                    {label}
                  </span>
                </span>
                {i < STEPS.length - 1 && <span className={cx('mx-2 h-px min-w-2 flex-1 sm:mx-3', done ? 'bg-brand-600' : 'bg-rule')} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <section className="flex flex-col gap-7" aria-labelledby="step1-heading">
            <div>
              <p className={eyebrow}>Step 1 of 3</p>
              <h2 id="step1-heading" ref={headingRef} tabIndex={-1} className={cx(h2Class, 'mt-1')}>
                What do you need?
              </h2>
              <p className="mt-1 text-sm text-ink-muted">Choose a service and a dentist. Not sure? Pick Exam and X-ray, and the dentist will advise.</p>
            </div>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-3 text-sm font-semibold text-ink">Service</legend>
              {services.length === 0 && <p className="text-sm text-ink-muted">No services are available for online booking right now.</p>}
              {services.length > 8 && (
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
                  <input
                    type="search"
                    aria-label="Search services"
                    placeholder="Search services"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="block h-11 w-full rounded-[10px] border border-line-strong bg-white pr-3 pl-9 text-base text-ink placeholder:text-ink-muted focus:border-brand-600 focus:ring-2 focus:ring-brand-600/40 focus:outline-none sm:text-sm"
                  />
                </div>
              )}
              {groups.map((g) => (
                <div key={g.label} role="group" aria-label={g.label}>
                  {(groups.length > 1 || g.label !== 'Other services') && <p className="mb-1.5 text-[13px] font-medium text-ink-muted">{g.label}</p>}
                  <div className="overflow-hidden rounded-xl border border-rule bg-white">
                    {g.items.map((s) => (
                      <ServiceRow key={s.id} checked={serviceId === s.id} onChange={() => pickService(s.id)} title={s.name} meta={`${s.durationMinutes} min`} />
                    ))}
                  </div>
                </div>
              ))}
              {services.length > 0 && groups.length === 0 && <p className="text-sm text-ink-muted" role="status">No service matches &ldquo;{query}&rdquo;.</p>}
              {errors.serviceId && (
                <p className="text-sm text-red-700" role="alert">
                  Please choose a service.
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-ink">Dentist</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <ChoiceCard name="dentist" checked={dentistId === 'any'} onChange={() => pickDentist('any')} title="Any available dentist" meta="Fastest" />
                {dentists.map((d) => (
                  <ChoiceCard key={d.id} name="dentist" checked={dentistId === d.id} onChange={() => pickDentist(d.id)} title={d.name} />
                ))}
              </div>
            </fieldset>

            <div className={actionBar}>
              <Button size="lg" className="w-full" disabled={!serviceId} onClick={() => setStep(2)}>
                Continue
              </Button>
              {!serviceId && services.length > 0 && <p className="mt-2 text-center text-xs text-ink-muted lg:text-left">Choose a service to continue.</p>}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="flex flex-col gap-6" aria-labelledby="step2-heading">
            <div>
              <p className={eyebrow}>Step 2 of 3</p>
              <h2 id="step2-heading" ref={headingRef} tabIndex={-1} className={cx(h2Class, 'mt-1')}>
                Pick a date and time
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {service?.name} · {dentistLabel}
              </p>
            </div>
            {takenNotice && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                {TAKEN_TEXT}
              </div>
            )}
            <div className="rounded-2xl border border-rule bg-white p-3 sm:p-4">
              <p id="cal-label" className="sr-only">
                Appointment date
              </p>
              <DateCalendar
                value={date}
                onChange={pickDate}
                min={today}
                max={maxDate}
                today={today}
                labelledBy="cal-label"
                isEnabled={(d) => workingDays.has(dayOfWeek(d))}
              />
            </div>

            {date && (
              <fieldset aria-describedby="slots-status">
                <legend className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <ClockIcon className="size-4 text-ink-muted" />
                  Open times on {formatDateHuman(date)}
                </legend>
                <div id="slots-status" aria-live="polite">
                  {slotsState === 'loading' && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Loading open times">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div key={i} className="h-12 animate-pulse rounded-[10px] bg-brand-100/70" />
                      ))}
                    </div>
                  )}
                  {slotsState === 'error' && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                      <span>We could not load the open times. Check your connection.</span>
                      <button type="button" className="inline-flex h-11 items-center rounded-lg border border-red-300 bg-white px-4 font-semibold" onClick={() => setSlotsReload((n) => n + 1)}>
                        Try again
                      </button>
                    </div>
                  )}
                  {slotsState === 'idle' && slots && slots.length === 0 && (
                    <div className="rounded-xl border border-dashed border-line-strong bg-white p-5 text-center">
                      <p className="text-sm font-semibold text-ink">No open times</p>
                      <p className="mt-1 text-sm text-ink-muted">Every time on this day is taken. Please pick another date.</p>
                    </div>
                  )}
                </div>
                {slotsState === 'idle' && slots && slots.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {morning.length > 0 && (
                      <div>
                        <p className="mb-2 text-[13px] font-medium text-ink-muted">Morning</p>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{slotButtons(morning)}</div>
                      </div>
                    )}
                    {afternoon.length > 0 && (
                      <div>
                        <p className="mb-2 text-[13px] font-medium text-ink-muted">Afternoon</p>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{slotButtons(afternoon)}</div>
                      </div>
                    )}
                  </div>
                )}
                {errors.start && !start && (
                  <p className="mt-2 text-sm text-red-700" role="alert">
                    Please pick a time.
                  </p>
                )}
              </fieldset>
            )}
            {!date && (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <CalendarIcon className="size-4 shrink-0" /> Choose a day to see open times. Greyed-out days are closed or already past.
              </p>
            )}

            <div className={cx(actionBar, 'flex gap-3')}>
              <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button size="lg" className="flex-[2]" disabled={!date || !start} onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-5" aria-labelledby="step3-heading">
            <div>
              <p className={eyebrow}>Step 3 of 3</p>
              <h2 id="step3-heading" ref={headingRef} tabIndex={-1} className={cx(h2Class, 'mt-1')}>
                Your details
              </h2>
            </div>

            {/* Phone and tablet: compact visit card. From 1024 px the side panel shows the same thing. */}
            <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm lg:hidden">
              <BrandIcon className="h-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{service?.name}</p>
                <p className="text-ink">
                  {when} · {dentistLabel}
                </p>
              </div>
              <button type="button" onClick={() => setStep(2)} className="-my-2 -mr-1 inline-flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-brand-800 underline">
                Change
              </button>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                id="book-fullName"
                label="Full name"
                name="fullName"
                autoComplete="name"
                required
                wrapperClassName="sm:col-span-2"
                value={details.fullName}
                onChange={(e) => setDetail('fullName', stripNameChars(e.target.value))}
                onBlur={() => validateField('fullName')}
                error={errors.fullName}
                maxLength={150}
              />
              <PhoneInput
                id="book-contactNumber"
                label="Contact number"
                name="contactNumber"
                required
                value={details.contactNumber}
                onValueChange={(d) => setDetail('contactNumber', d)}
                onBlur={() => validateField('contactNumber')}
                error={errors.contactNumber}
              />
              <Input
                id="book-birthdate"
                label="Birthdate"
                name="birthdate"
                type="date"
                autoComplete="bday"
                required
                min="1900-01-01"
                max={today}
                value={details.birthdate}
                onChange={(e) => setDetail('birthdate', e.target.value)}
                onBlur={() => validateField('birthdate')}
                error={errors.birthdate}
              />
              <Input
                id="book-email"
                label="Email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@email.com"
                required
                wrapperClassName="sm:col-span-2"
                value={details.email}
                onChange={(e) => setDetail('email', e.target.value)}
                onBlur={() => validateField('email')}
                error={errors.email}
                hint="We send the confirmation here."
                maxLength={150}
              />
              <Textarea
                id="book-patientNote"
                label="Note for the clinic"
                optional
                name="patientNote"
                rows={3}
                maxLength={1000}
                wrapperClassName="sm:col-span-2"
                placeholder="e.g. tooth pain on the lower left"
                value={details.patientNote}
                onChange={(e) => setDetail('patientNote', e.target.value)}
                error={errors.patientNote}
              />
            </div>

            {/* Honeypot: hidden from people and assistive tech; bots that fill it are dropped server-side. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor="book-website">Website</label>
              <input ref={honeypotRef} id="book-website" type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>

            <div className="flex flex-col gap-2">
              <Checkbox
                id="book-consent"
                name="consent"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  if (e.target.checked)
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.consent;
                      return next;
                    });
                }}
                label={CONSENT_TEXT}
                error={errors.consent}
              />
              <p id="book-privacy" className="text-xs leading-relaxed text-ink-muted">
                The clinic uses these details only to schedule your visit and send its confirmation and reminder. This is a demo
                system: all data is deleted after the project defense. To see, correct or delete your details,{' '}
                {clinicPhone ? `call the clinic at ${clinicPhone}` : 'contact the clinic'}.
              </p>
            </div>

            <FormError>{formError}</FormError>

            <div className={actionBar}>
              <div className="flex gap-3">
                <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep(2)} disabled={submitting}>
                  Back
                </Button>
                <Button type="submit" size="lg" className="flex-[2]" disabled={!consent} loading={submitting} loadingText="Sending…">
                  Request appointment
                </Button>
              </div>
              {!consent && <p className="mt-2 text-center text-xs text-ink-muted lg:text-left">Tick the consent box to send your request.</p>}
            </div>
          </section>
        )}
      </form>

      <aside aria-label="Your visit" className="hidden rounded-2xl border border-rule bg-white p-5 lg:sticky lg:top-6 lg:block">
        <div className="flex items-center gap-3">
          <BrandIcon className="h-9" />
          <p className="text-base font-bold text-ink">Your visit</p>
        </div>
        <dl className="mt-4 divide-y divide-rule text-sm">
          <AsideRow label="Service" value={service ? `${service.name} · ${service.durationMinutes} min` : null} />
          <AsideRow label="Dentist" value={dentistLabel} />
          <AsideRow label="When" value={when} />
        </dl>
        {step === 3 && (
          <button type="button" onClick={() => setStep(2)} className="mt-3 inline-flex h-10 items-center rounded-lg px-1 text-sm font-semibold text-brand-800 underline">
            Change
          </button>
        )}
        <p className="mt-4 rounded-lg bg-brand-50 p-3 text-xs leading-relaxed text-ink">
          This sends a request. The clinic confirms it by email, so there is nothing to pay now.
        </p>
        {clinicPhone && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
            <PhoneIcon className="size-4 shrink-0" />
            Questions? Call {clinicPhone}
          </p>
        )}
      </aside>
    </div>
  );
}

/** Compact radio row inside a grouped list: 52 px tall, whole row is the tap target. */
function ServiceRow({ checked, onChange, title, meta }: { checked: boolean; onChange: () => void; title: string; meta: string }) {
  return (
    <label
      className={cx(
        'flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-rule px-4 py-2.5 transition-colors last:border-b-0',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-brand-600',
        checked ? 'bg-brand-100/70' : 'hover:bg-brand-50',
      )}
    >
      <input type="radio" name="service" checked={checked} onChange={onChange} className="size-5 shrink-0 accent-brand-700" />
      <span className={cx('min-w-0 flex-1 text-base text-ink', checked ? 'font-semibold' : 'font-medium')}>{title}</span>
      <span className="shrink-0 text-sm text-ink-muted tabular-nums">{meta}</span>
    </label>
  );
}

function ChoiceCard({ name, checked, onChange, title, meta }: { name: string; checked: boolean; onChange: () => void; title: string; meta?: string }) {
  return (
    <label
      className={cx(
        'flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-2.5 transition-colors',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
        checked ? 'border-brand-600 bg-brand-100/70 ring-1 ring-brand-600' : 'border-rule hover:border-line-strong hover:bg-brand-50',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-5 shrink-0 accent-brand-700" />
      <span className={cx('min-w-0 flex-1 text-base text-ink', checked ? 'font-semibold' : 'font-medium')}>{title}</span>
      {meta && <span className="shrink-0 text-sm text-ink-muted">{meta}</span>}
    </label>
  );
}

function AsideRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="py-3 first:pt-0">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className={cx('mt-0.5', value ? 'font-medium text-ink' : 'text-ink-muted')}>{value || 'Not chosen yet'}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-ink">{value}</dd>
    </div>
  );
}
