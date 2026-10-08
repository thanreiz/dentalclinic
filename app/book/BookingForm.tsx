'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/components/api';
import { DateCalendar } from '@/components/booking/DateCalendar';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { Checkbox, FormError, Input, Textarea } from '@/components/ui/Field';
import { AlertIcon, CalendarIcon, CheckIcon, ClockIcon, ToothIcon } from '@/components/ui/icons';
import { dayOfWeek, formatDateHuman, formatTime12 } from '@/lib/time';
import type { Slot } from '@/lib/types';
import { bookingRequestSchema, fieldErrors } from '@/lib/validation';

export type BookService = { id: number; name: string; durationMinutes: number };
export type BookDentist = { id: number; name: string; workingDays: number[] };

type Props = {
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
  { n: 3, label: 'Your details' },
] as const;

export default function BookingForm({ services, dentists, today, maxDate, clinicPhone }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [serviceId, setServiceId] = useState<number | null>(services.length === 1 ? services[0].id : null);
  const [dentistId, setDentistId] = useState<number | 'any'>('any');
  const [date, setDate] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
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
  const firstRender = useRef(true);

  const service = services.find((s) => s.id === serviceId) ?? null;
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
    };
    const { website, ...toCheck } = payload;
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
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="status" aria-live="polite">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-green-100 text-green-700">
          <CheckIcon className="size-7" />
        </div>
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-xl font-semibold text-slate-900 outline-none">
          Thank you
        </h2>
        <p className="mt-2 text-base text-slate-700">Request received. The clinic will email you once it is confirmed.</p>
        <dl className="mt-5 space-y-2 rounded-lg bg-slate-50 p-4 text-left text-sm">
          <SummaryRow label="Service" value={service?.name ?? ''} />
          <SummaryRow label="Dentist" value={dentistLabel} />
          {date && start && <SummaryRow label="When" value={`${formatDateHuman(date)}, ${formatTime12(start)}`} />}
          <SummaryRow label="Email" value={details.email} />
        </dl>
        <p className="mt-4 text-sm text-slate-600">
          This is a request, not yet a confirmed booking.
          {clinicPhone ? ` For changes, call the clinic at ${clinicPhone}.` : ''}
        </p>
        <Button variant="secondary" size="lg" className="mt-6 w-full" onClick={resetAll}>
          Book another appointment
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <ol className="grid grid-cols-3 gap-2" aria-label="Booking steps">
        {STEPS.map(({ n, label }) => {
          const active = step === n;
          const done = typeof step === 'number' && step > n;
          return (
            <li key={n} aria-current={active ? 'step' : undefined} className="flex flex-col gap-1.5">
              <span className={cx('h-1.5 rounded-full', active || done ? 'bg-brand-600' : 'bg-slate-200')} />
              <span className={cx('text-xs font-medium', active ? 'text-brand-800' : done ? 'text-slate-700' : 'text-slate-500')}>
                <span className="sr-only">Step {n}: </span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <section className="flex flex-col gap-5" aria-labelledby="step1-heading">
          <h2 id="step1-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">
            What do you need?
          </h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-slate-800">Service</legend>
            {services.length === 0 && <p className="text-sm text-slate-600">No services are available for online booking right now.</p>}
            {services.map((s) => (
              <ChoiceCard
                key={s.id}
                name="service"
                checked={serviceId === s.id}
                onChange={() => pickService(s.id)}
                title={s.name}
                meta={`${s.durationMinutes} min`}
              />
            ))}
            {errors.serviceId && <p className="text-sm text-red-700" role="alert">Please choose a service.</p>}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-slate-800">Dentist</legend>
            <ChoiceCard
              name="dentist"
              checked={dentistId === 'any'}
              onChange={() => pickDentist('any')}
              title="Any available dentist"
              meta="Fastest"
            />
            {dentists.map((d) => (
              <ChoiceCard key={d.id} name="dentist" checked={dentistId === d.id} onChange={() => pickDentist(d.id)} title={d.name} />
            ))}
          </fieldset>
          <Button size="lg" className="w-full" disabled={!serviceId} onClick={() => setStep(2)}>
            Continue
          </Button>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-5" aria-labelledby="step2-heading">
          <div>
            <h2 id="step2-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">
              Pick a date and time
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {service?.name} · {dentistLabel}
            </p>
          </div>
          {takenNotice && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              {TAKEN_TEXT}
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
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
              <legend className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-800">
                <ClockIcon className="size-4 text-slate-500" />
                Open times on {formatDateHuman(date)}
              </legend>
              <div id="slots-status" aria-live="polite">
                {slotsState === 'loading' && (
                  <div className="grid grid-cols-3 gap-2" aria-label="Loading open times">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/70" />
                    ))}
                  </div>
                )}
                {slotsState === 'error' && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    Could not load open times.{' '}
                    <button type="button" className="font-semibold underline" onClick={() => setSlotsReload((n) => n + 1)}>
                      Try again
                    </button>
                  </div>
                )}
                {slotsState === 'idle' && slots && slots.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center">
                    <p className="text-sm font-semibold text-slate-900">No open times</p>
                    <p className="mt-1 text-sm text-slate-600">Every time on this day is taken. Please pick another date.</p>
                  </div>
                )}
              </div>
              {slotsState === 'idle' && slots && slots.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((s) => {
                    const checked = start === s.start;
                    return (
                      <label
                        key={s.start}
                        className={cx(
                          'relative flex h-12 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition-colors',
                          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                          checked
                            ? 'bg-brand-700 text-white shadow-sm'
                            : 'bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-brand-50 hover:ring-brand-400',
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
                  })}
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
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <CalendarIcon className="size-4" /> Choose a day to see open times. Greyed-out days are closed.
            </p>
          )}

          <div className="flex gap-3">
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
        <section className="flex flex-col gap-4" aria-labelledby="step3-heading">
          <h2 id="step3-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">
            Your details
          </h2>

          <div className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm">
            <ToothIcon className="mt-0.5 size-5 shrink-0 text-brand-700" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">{service?.name}</p>
              <p className="text-slate-700">
                {date && start ? `${formatDateHuman(date)}, ${formatTime12(start)}` : ''} · {dentistLabel}
              </p>
            </div>
            <button type="button" onClick={() => setStep(2)} className="-my-2.5 -mr-1.5 inline-flex h-11 shrink-0 items-center rounded px-2 text-sm font-semibold text-brand-800 underline">
              Change
            </button>
          </div>

          <Input
            id="book-fullName"
            label="Full name"
            name="fullName"
            autoComplete="name"
            required
            value={details.fullName}
            onChange={(e) => setDetail('fullName', e.target.value)}
            onBlur={() => validateField('fullName')}
            error={errors.fullName}
            maxLength={150}
          />
          <Input
            id="book-contactNumber"
            label="Contact number"
            name="contactNumber"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0917 555 0101"
            required
            value={details.contactNumber}
            onChange={(e) => setDetail('contactNumber', e.target.value)}
            onBlur={() => validateField('contactNumber')}
            error={errors.contactNumber}
            maxLength={30}
          />
          <Input
            id="book-email"
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
            required
            value={details.email}
            onChange={(e) => setDetail('email', e.target.value)}
            onBlur={() => validateField('email')}
            error={errors.email}
            hint="We send the confirmation here."
            maxLength={150}
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
          <Textarea
            id="book-patientNote"
            label="Note for the clinic"
            optional
            name="patientNote"
            rows={3}
            maxLength={1000}
            placeholder="e.g. tooth pain on the lower left"
            value={details.patientNote}
            onChange={(e) => setDetail('patientNote', e.target.value)}
            error={errors.patientNote}
          />

          {/* Honeypot: hidden from people and assistive tech; bots that fill it are dropped server-side. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
            <label htmlFor="book-website">Website</label>
            <input ref={honeypotRef} id="book-website" type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>

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
          <p id="book-privacy" className="-mt-2 text-xs leading-relaxed text-slate-600">
            The clinic uses these details only to schedule your visit and send its confirmation and reminder. This is a demo
            system: all data is deleted after the project defense. To see, correct or delete your details,{' '}
            {clinicPhone ? `call the clinic at ${clinicPhone}` : 'contact the clinic'}.
          </p>

          <FormError>{formError}</FormError>

          <div className="flex gap-3">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep(2)} disabled={submitting}>
              Back
            </Button>
            <Button type="submit" size="lg" className="flex-[2]" disabled={!consent} loading={submitting} loadingText="Sending…">
              Request appointment
            </Button>
          </div>
          {!consent && <p className="-mt-2 text-center text-xs text-slate-500">Tick the consent box to send your request.</p>}
        </section>
      )}
    </form>
  );
}

function ChoiceCard({ name, checked, onChange, title, meta }: { name: string; checked: boolean; onChange: () => void; title: string; meta?: string }) {
  return (
    <label
      className={cx(
        'flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border bg-white px-4 py-3 transition-colors',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
        checked ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-300 hover:border-slate-400',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-5 shrink-0 accent-brand-700" />
      <span className="min-w-0 flex-1 text-base font-medium text-slate-900">{title}</span>
      {meta && <span className="shrink-0 text-sm text-slate-600">{meta}</span>}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-slate-900">{value}</dd>
    </div>
  );
}
