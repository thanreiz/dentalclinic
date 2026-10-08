'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AppointmentStatus } from '@/lib/rules';
import { formatDateHuman, formatTime12 } from '@/lib/time';
import type { Slot } from '@/lib/types';
import { api, errorMessage } from '@/components/api';
import { ChairPicker } from '@/components/staff/ChairPicker';
import { useFreeChairs, useOpenSlots, type FreeChair } from '@/components/staff/hooks';
import { SlotPicker } from '@/components/staff/SlotPicker';
import { StatusBadge } from '@/components/ui/Badges';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormError, Input, Select } from '@/components/ui/Field';
import { AlertIcon, InfoIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';

type Appt = {
  id: number;
  status: AppointmentStatus;
  date: string;
  start: string;
  end: string;
  startPassed: boolean;
  allowedTransitions: AppointmentStatus[];
  patientId: number;
  patientName: string;
  patientEmail: string | null;
  serviceId: number;
  dentistId: number;
  chairId: number | null;
};
type DentistOpt = { id: number; name: string };

const CONFLICT_REASONS: Record<string, string> = {
  chair_conflict: 'That chair was booked for this time by another appointment.',
  dentist_conflict: 'The dentist now has another appointment at this time.',
  in_past: 'The requested time has already passed.',
  outside_hours: "The time is no longer inside the dentist's working hours.",
};

export default function AppointmentActions({ appointment: a, dentists, today }: { appointment: Appt; dentists: DentistOpt[]; today: string }) {
  if (a.status === 'pending') return <PendingActions a={a} today={today} />;
  if (a.status === 'scheduled') return <ScheduledActions a={a} dentists={dentists} today={today} />;
  return (
    <Card>
      <CardHeader title="Actions" />
      <div className="flex items-start gap-3 px-4 py-4 text-sm text-slate-700 sm:px-5">
        <InfoIcon className="mt-0.5 size-5 shrink-0 text-slate-400" />
        <p>
          This appointment is <StatusBadge status={a.status} />. That status is final, so there is nothing more to change. You can still edit the dentist
          note.
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pending: chair picker + Confirm, Decline
// ---------------------------------------------------------------------------

function PendingActions({ a, today }: { a: Appt; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const free = useFreeChairs(a.startPassed ? null : { date: a.date, start: a.start, end: a.end, excludeId: a.id });
  const [chairId, setChairId] = useState<number | null>(null);
  const [chairError, setChairError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [conflict, setConflict] = useState<{ reason?: string; slots: Slot[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const chairs = free.chairs;
  const effectiveChair = chairId ?? (chairs && chairs.length === 1 ? chairs[0].chairId : null);

  async function confirm() {
    if (!effectiveChair) {
      setChairError('Pick a free chair first.');
      return;
    }
    setChairError(null);
    setFormError(null);
    setConfirming(true);
    const r = await api<{ emailSent?: boolean; emailError?: string; emailSkipped?: string; slots?: Slot[]; freeChairs?: FreeChair[]; reason?: string }>(
      `/api/appointments/${a.id}/confirm`,
      { body: { chairId: effectiveChair } },
    );
    setConfirming(false);
    if (r.ok) {
      if (r.data.emailError) {
        toast.show({ tone: 'warning', title: 'Confirmed, but the email could not be sent.', description: 'The appointment is scheduled. Let the patient know by phone.' });
      } else if (r.data.emailSent) {
        toast.show({ tone: 'success', title: 'Request confirmed', description: `Confirmation email sent to ${a.patientEmail ?? 'the patient'}.` });
      } else {
        toast.show({ tone: 'success', title: 'Request confirmed', description: 'The patient has no email on file, so no confirmation was sent.' });
      }
      router.refresh();
      return;
    }
    if (r.status === 409 && r.data.error === 'slot_unavailable') {
      setConflict({ reason: r.data.reason, slots: Array.isArray(r.data.slots) ? r.data.slots : [] });
      if (Array.isArray(r.data.freeChairs)) free.setChairs(r.data.freeChairs);
      setChairId(null);
      return;
    }
    if (r.status === 409 && r.data.error === 'invalid_transition') {
      toast.show({ tone: 'error', title: 'Could not confirm', description: errorMessage(r) });
      router.refresh();
      return;
    }
    if (r.data.issues?.chairId) {
      setChairError(r.data.issues.chairId);
      free.reload();
      return;
    }
    setFormError(errorMessage(r, 'Could not confirm this request.'));
  }

  async function decline() {
    setDeclining(true);
    const r = await api(`/api/appointments/${a.id}/decline`, { body: {} });
    setDeclining(false);
    setDeclineOpen(false);
    if (r.ok) {
      toast.show({ tone: 'success', title: 'Request declined', description: 'The time slot is free again. No email was sent.' });
      router.refresh();
    } else {
      toast.show({ tone: 'error', title: 'Could not decline', description: errorMessage(r) });
      router.refresh();
    }
  }

  const rebookHref = `/appointments/new?${new URLSearchParams({
    patientId: String(a.patientId),
    serviceId: String(a.serviceId),
    dentistId: String(a.dentistId),
    date: a.date >= today ? a.date : today,
    channel: 'phone',
  })}`;

  return (
    <Card>
      <CardHeader title="Review request" description="Pick a free chair, then confirm. Confirming emails the patient." />
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        {a.startPassed ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900" role="status">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>The requested time has passed, so this request can no longer be confirmed. Decline it to clear it from the queue.</p>
          </div>
        ) : (
          <>
            {conflict && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950" role="alert">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertIcon className="size-4" /> Slot no longer free
                </p>
                <p className="mt-1">{(conflict.reason && CONFLICT_REASONS[conflict.reason]) || 'This time cannot be confirmed any more.'}</p>
                {conflict.slots.length > 0 ? (
                  <>
                    <p className="mt-2 font-medium">Open times for this dentist on {formatDateHuman(a.date)}:</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {conflict.slots.map((s) => (
                        <li key={s.start}>
                          <Link
                            href={`${rebookHref.replace(/&date=[^&]*/, `&date=${a.date}`)}&start=${s.start}`}
                            className="inline-flex h-8 items-center rounded-md bg-white px-2 text-xs font-semibold text-brand-800 ring-1 ring-amber-300 hover:bg-brand-50"
                          >
                            {formatTime12(s.start)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-2">No other open times for this dentist that day.</p>
                )}
                <p className="mt-2 text-amber-900">
                  If only the chair clashed, pick another free chair below. Otherwise book the patient at a new time (they stay one record), then decline
                  this request.
                </p>
                <Link href={rebookHref} className={buttonClasses('secondary', 'sm', 'mt-2.5')}>
                  Book {a.patientName.split(' ')[0]} at another time
                </Link>
              </div>
            )}
            <ChairPicker
              chairs={free.chairs}
              state={free.state}
              value={effectiveChair}
              onChange={(id) => {
                setChairId(id);
                setChairError(null);
              }}
              onRetry={free.reload}
              error={chairError}
              name="confirm-chair"
            />
            <FormError>{formError}</FormError>
            <Button onClick={confirm} loading={confirming} loadingText="Confirming…" disabled={!effectiveChair} className="w-full" variant="primary" size="lg">
              Confirm request
            </Button>
          </>
        )}
        <Button variant={a.startPassed ? 'danger' : 'secondary'} className="w-full" onClick={() => setDeclineOpen(true)}>
          Decline request
        </Button>
      </div>
      <ConfirmDialog
        open={declineOpen}
        title="Decline this request?"
        description={
          <>
            {a.patientName}&apos;s request for {formatDateHuman(a.date)}, {formatTime12(a.start)} will be marked declined. The slot is freed right away and no email
            is sent. This cannot be undone.
          </>
        }
        confirmLabel="Decline request"
        tone="danger"
        loading={declining}
        onConfirm={decline}
        onCancel={() => setDeclineOpen(false)}
      />
    </Card>
  );
}


// ---------------------------------------------------------------------------
// Scheduled: status buttons (Rule 7) + reschedule panel (Rule 11)
// ---------------------------------------------------------------------------

const STATUS_ACTIONS: { to: 'attended' | 'no-show' | 'cancelled'; label: string; variant: 'success' | 'danger' | 'secondary'; help: string }[] = [
  { to: 'attended', label: 'Mark attended', variant: 'success', help: 'The patient came for the visit.' },
  { to: 'no-show', label: 'Mark no-show', variant: 'danger', help: 'The patient did not come. Counts toward the repeat no-show list.' },
  { to: 'cancelled', label: 'Cancel appointment', variant: 'secondary', help: 'The visit will not happen. The slot is freed.' },
];

function ScheduledActions({ a, dentists, today }: { a: Appt; dentists: DentistOpt[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pendingStatus, setPendingStatus] = useState<(typeof STATUS_ACTIONS)[number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);

  const allowed = STATUS_ACTIONS.filter((s) => a.allowedTransitions.includes(s.to));
  const lockedUntilStart = !a.startPassed;

  async function setStatus() {
    if (!pendingStatus) return;
    setSaving(true);
    const r = await api(`/api/appointments/${a.id}/status`, { body: { status: pendingStatus.to } });
    setSaving(false);
    const label = pendingStatus.to;
    setPendingStatus(null);
    if (r.ok) {
      toast.show({ tone: 'success', title: `Marked ${label}` });
    } else {
      toast.show({ tone: 'error', title: 'Could not update the status', description: errorMessage(r) });
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Attendance" description="Record what happened. These statuses are final." />
        <div className="flex flex-col gap-2.5 px-4 py-4 sm:px-5">
          {allowed.map((s) => (
            <Button key={s.to} variant={s.variant} className="w-full justify-center" onClick={() => setPendingStatus(s)}>
              {s.label}
            </Button>
          ))}
          {lockedUntilStart && (
            <p className="flex items-start gap-2 text-sm text-slate-600">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
              Attended and No-show unlock once the start time ({formatTime12(a.start)}, {formatDateHuman(a.date)}) has passed.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Reschedule"
          description="Moves the visit: this appointment becomes cancelled and a new linked one is created."
          actions={
            !showReschedule && (
              <Button variant="secondary" size="sm" onClick={() => setShowReschedule(true)}>
                Reschedule…
              </Button>
            )
          }
        />
        {showReschedule && <RescheduleForm a={a} dentists={dentists} today={today} onCancel={() => setShowReschedule(false)} />}
      </Card>

      <ConfirmDialog
        open={!!pendingStatus}
        title={pendingStatus ? `${pendingStatus.label}?` : ''}
        description={
          pendingStatus && (
            <>
              {pendingStatus.help} {a.patientName}, {formatDateHuman(a.date)} {formatTime12(a.start)}. This status is final and cannot be changed later.
            </>
          )
        }
        confirmLabel={pendingStatus?.label ?? 'Confirm'}
        tone={pendingStatus?.variant === 'secondary' ? 'danger' : (pendingStatus?.variant ?? 'primary')}
        cancelLabel="Go back"
        loading={saving}
        onConfirm={setStatus}
        onCancel={() => setPendingStatus(null)}
      />
    </div>
  );
}

function RescheduleForm({ a, dentists, today, onCancel }: { a: Appt; dentists: DentistOpt[]; today: string; onCancel: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(a.date >= today ? a.date : today);
  const [dentistId, setDentistId] = useState(a.dentistId);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [chairId, setChairId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today;
  const slots = useOpenSlots(validDate ? { date, serviceId: a.serviceId, dentistId, excludeAppointmentId: a.id } : null);
  const free = useFreeChairs(slot ? { date, start: slot.start, end: slot.end, excludeId: a.id } : null);
  const effectiveChair =
    chairId && free.chairs?.some((c) => c.chairId === chairId)
      ? chairId
      : free.chairs?.some((c) => c.chairId === a.chairId)
        ? a.chairId
        : (free.chairs?.[0]?.chairId ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!validDate) errs.date = 'Pick today or a later date';
    if (!slot) errs.start = 'Pick an open time';
    if (slot && !effectiveChair) errs.chairId = 'Pick a free chair';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setFormError(null);
    const r = await api<{ newId?: number }>(`/api/appointments/${a.id}/reschedule`, {
      body: { date, start: slot!.start, dentistId, chairId: effectiveChair },
    });
    setSaving(false);
    if (r.ok && r.data.newId) {
      toast.show({
        tone: 'success',
        title: 'Appointment rescheduled',
        description: `Now ${formatDateHuman(date)}, ${formatTime12(slot!.start)}. #${a.id} was cancelled and linked.`,
      });
      router.push(`/appointments/${r.data.newId}`);
      router.refresh();
      return;
    }
    if (r.status === 400 && r.data.issues) {
      setErrors(r.data.issues);
      setFormError(errorMessage(r));
      return;
    }
    setFormError(errorMessage(r, 'Could not reschedule.'));
    if (r.status === 409) {
      setSlot(null);
      slots.reload();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-4 py-4 sm:px-5" noValidate>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Input
          label="New date"
          type="date"
          min={today}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSlot(null);
          }}
          error={errors.date}
          required
        />
        <Select
          label="Dentist"
          value={dentistId}
          onChange={(e) => {
            setDentistId(Number(e.target.value));
            setSlot(null);
          }}
          error={errors.dentistId}
        >
          {dentists.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>
      <SlotPicker
        slots={slots.slots}
        state={slots.state}
        value={slot?.start ?? null}
        onChange={(s) => {
          setSlot(s);
          setChairId(null);
        }}
        onRetry={slots.reload}
        error={errors.start}
        emptyText="No open times for this dentist on that day. Try another date or dentist."
        name="reschedule-slot"
      />
      <ChairPicker
        chairs={free.chairs}
        state={free.state}
        value={effectiveChair}
        onChange={setChairId}
        onRetry={free.reload}
        error={errors.chairId}
        disabledReason={slot ? undefined : 'Pick a time to see free chairs.'}
        name="reschedule-chair"
      />
      <FormError>{formError}</FormError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Close
        </Button>
        <Button type="submit" loading={saving} loadingText="Rescheduling…" disabled={!slot || !effectiveChair}>
          Reschedule
        </Button>
      </div>
    </form>
  );
}
