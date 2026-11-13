'use client';

import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/components/api';
import { DateCalendar } from '@/components/booking/DateCalendar';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { CalendarIcon, CheckIcon, ClockIcon } from '@/components/ui/icons';
import { dayOfWeek, formatDateHuman, formatTime12 } from '@/lib/time';
import type { Slot } from '@/lib/types';

type Appt = {
  patientFirstName: string;
  date: string;
  start: string;
  dentistId: number;
  dentistName: string;
  serviceId: number;
  serviceName: string;
};

type Pending = { date: string; start: string; position: number };
type Props = { token: string; pending: Pending | null; appt: Appt; workingDays: number[]; today: string; maxDate: string; clinicPhone?: string };

/**
 * Patient asks for a new open time with the same dentist. It is a request: the clinic approves it
 * (first come, first served when several patients ask for the same time); the current time stays until then.
 */
export default function ManageAppointment({ token, pending: initialPending, appt, workingDays, today, maxDate, clinicPhone }: Props) {
  const current = { date: appt.date, start: appt.start };
  const [pending, setPending] = useState<Pending | null>(initialPending);
  const [mode, setMode] = useState<'view' | 'pick' | 'done'>('view');
  const [date, setDate] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsState, setSlotsState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = new Set(workingDays);

  useEffect(() => {
    if (!date) return;
    const ctrl = new AbortController();
    setSlotsState('loading');
    const qs = new URLSearchParams({ date, serviceId: String(appt.serviceId), dentistId: String(appt.dentistId) });
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
  }, [date, appt.serviceId, appt.dentistId, reload]);

  async function confirm() {
    if (!date || !start) return;
    setSaving(true);
    setError(null);
    const r = await api<{ position?: number; slots?: Slot[] }>('/api/manage/reschedule', { body: { token, date, start } });
    setSaving(false);
    if (r.ok) {
      setPending({ date, start, position: Number(r.data.position) || 1 });
      setMode('done');
      return;
    }
    if (r.data.error === 'slot_unavailable' && Array.isArray(r.data.slots)) {
      setSlots(r.data.slots);
      setStart(null);
    }
    setError(errorMessage(r));
  }

  const card = (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-ink">
      <p className="font-semibold">{appt.serviceName}</p>
      <p className="mt-1 flex items-center gap-2">
        <CalendarIcon className="size-4 text-ink-muted" />
        {formatDateHuman(current.date)}, {formatTime12(current.start)}
      </p>
      <p className="mt-1 text-ink-muted">with {appt.dentistName}</p>
    </div>
  );

  const pendingNote = pending && (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
      <p className="font-semibold">
        Requested: {formatDateHuman(pending.date)}, {formatTime12(pending.start)}
      </p>
      <p className="mt-1">
        Waiting for the clinic to approve.{' '}
        {pending.position > 1
          ? `You are #${pending.position} in line for this time; requests are approved first come, first served.`
          : 'You are first in line for this time.'}{' '}
        Your current time stays until then.
      </p>
    </div>
  );

  if (mode === 'done') {
    return (
      <div className="motion-step mx-auto w-full max-w-3xl px-4 py-8">
        <span className="grid size-12 place-items-center rounded-full bg-brand-100 text-brand-900">
          <CheckIcon className="size-6" />
        </span>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-ink">Request sent</h2>
        <p className="mt-2 text-ink-muted">The clinic will confirm your new time. We will message you once it is approved.</p>
        <div className="mt-5 flex flex-col gap-3">
          {pendingNote}
          <p className="text-sm font-medium text-ink-muted">Current appointment</p>
          {card}
        </div>
        <Button variant="secondary" className="mt-6" onClick={() => { setMode('pick'); setDate(null); setStart(null); }}>
          Pick a different time instead
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <div>
        <p className="text-[13px] font-medium text-ink-muted">Hi {appt.patientFirstName}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">Your appointment</h2>
      </div>
      {card}
      {pendingNote}

      {mode === 'view' && (
        <div className="flex flex-col gap-3">
          <Button onClick={() => setMode('pick')}>{pending ? 'Change my request' : 'Reschedule'}</Button>
          <p className="text-sm text-ink-muted">
            To cancel, please contact the clinic{clinicPhone ? ` at ${clinicPhone}` : ''}.
          </p>
        </div>
      )}

      {mode === 'pick' && (
        <section className="motion-step flex flex-col gap-5" aria-labelledby="pick-heading">
          <h3 id="pick-heading" className="text-lg font-semibold text-ink">
            Pick a new day and time with {appt.dentistName}
          </h3>
          <p className="-mt-3 text-sm text-ink-muted">The clinic confirms the new time. If others ask for the same time, the first request approved gets it.</p>
          <DateCalendar
            value={date}
            onChange={(d) => {
              setDate(d);
              setStart(null);
              setError(null);
            }}
            min={today}
            max={maxDate}
            today={today}
            isEnabled={(d) => days.has(dayOfWeek(d))}
            labelledBy="pick-heading"
          />

          {date && (
            <fieldset>
              <legend className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <ClockIcon className="size-4 text-ink-muted" />
                Open times on {formatDateHuman(date)}
              </legend>
              <div aria-live="polite">
                {slotsState === 'loading' && <p className="text-sm text-ink-muted">Loading open times…</p>}
                {slotsState === 'error' && (
                  <p className="text-sm text-red-800">
                    We could not load the open times.{' '}
                    <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>
                      Try again
                    </button>
                  </p>
                )}
                {slotsState === 'idle' && slots && slots.length === 0 && (
                  <p className="text-sm text-ink-muted">No open times on this day. Please pick another date.</p>
                )}
              </div>
              {slotsState === 'idle' && slots && slots.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => {
                    const checked = start === s.start;
                    return (
                      <label
                        key={s.start}
                        className={cx(
                          'flex h-12 cursor-pointer items-center justify-center rounded-[10px] text-[15px] font-semibold tabular-nums',
                          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                          checked ? 'bg-brand-700 text-white' : 'bg-white text-ink ring-1 ring-line-strong hover:bg-brand-50',
                        )}
                      >
                        <input type="radio" name="slot" value={s.start} checked={checked} onChange={() => setStart(s.start)} className="sr-only" />
                        {formatTime12(s.start)}
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={confirm} disabled={!date || !start} loading={saving} loadingText="Sending…">
              {date && start ? `Request ${formatDateHuman(date)}, ${formatTime12(start)}` : 'Pick a time'}
            </Button>
            <Button variant="secondary" onClick={() => { setMode('view'); setError(null); }}>
              Keep current time
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
