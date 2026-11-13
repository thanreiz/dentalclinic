'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { formatContact, normalizeMobile, STAFF_CHANNELS, type StaffChannel } from '@/lib/rules';
import { dayOfWeek, formatDateHuman, formatTime12 } from '@/lib/time';
import type { Slot } from '@/lib/types';
import { stripNameChars } from '@/lib/name';
import type { NewPatient } from '@/lib/validation';
import { api, errorMessage } from '@/components/api';
import { ChairPicker } from '@/components/staff/ChairPicker';
import { useFreeChairs, useOpenSlots } from '@/components/staff/hooks';
import { SlotPicker } from '@/components/staff/SlotPicker';
import { ChannelBadge } from '@/components/ui/Badges';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { FormError, Input, Select, Textarea } from '@/components/ui/Field';
import { PhoneInput, cleanMobileDigits } from '@/components/ui/PhoneInput';
import { PlusIcon, SearchIcon, Spinner, XIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';

type PatientPick = { patientId: number; fullName: string; contactNumber: string; email: string | null; birthdate: string };
type Props = {
  today: string;
  services: { id: number; name: string; durationMinutes: number }[];
  dentists: { id: number; name: string; workingDays: number[] }[];
  chairCount: number;
  initial: {
    patient: PatientPick | null;
    serviceId?: number;
    dentistId?: number;
    date?: string;
    start?: string;
    channel?: StaffChannel;
    followUpOf?: number;
  };
};

const CHANNEL_LABELS: Record<StaffChannel, string> = { phone: 'Phone call', chat: 'Chat message', 'walk-in': 'Walk-in' };

function normalizePatients(data: unknown): { rows: PatientPick[]; total: number } {
  const d = (data ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(d.rows) ? d.rows : Array.isArray(d.patients) ? d.patients : Array.isArray(d.results) ? d.results : []) as Record<
    string,
    unknown
  >[];
  const rows = arr.map((p) => ({
    patientId: Number(p.patientId ?? p.patient_id ?? p.id),
    fullName: String(p.fullName ?? p.full_name ?? ''),
    contactNumber: String(p.contactNumber ?? p.contact_number ?? ''),
    email: (p.email as string | null) ?? null,
    birthdate: String(p.birthdate ?? ''),
  }));
  return { rows, total: Number(d.total ?? rows.length) };
}

export default function NewBookingForm({ today, services, dentists, chairCount, initial }: Props) {
  const router = useRouter();
  const toast = useToast();

  // patient
  const [mode, setMode] = useState<'search' | 'new'>('search');
  const [patient, setPatient] = useState<PatientPick | null>(initial.patient);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ rows: PatientPick[]; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [newPatient, setNewPatient] = useState({ fullName: '', contactNumber: '', email: '', birthdate: '' });

  // visit
  const [serviceId, setServiceId] = useState<number | null>(initial.serviceId ?? null);
  const [dentistId, setDentistId] = useState<number | null>(initial.dentistId ?? null);
  const [date, setDate] = useState(initial.date ?? today);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [chairId, setChairId] = useState<number | null>(null);
  const [channel, setChannel] = useState<StaffChannel>(initial.channel ?? 'phone');
  const [note, setNote] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const prefillStart = useRef(initial.start ?? null);

  // Debounced patient search (GET /api/patients?q=)
  useEffect(() => {
    if (mode !== 'search' || patient) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const h = setTimeout(() => {
      api(`/api/patients?${new URLSearchParams({ q })}`, { signal: ctrl.signal })
        .then((r) => {
          setResults(r.ok ? normalizePatients(r.data) : { rows: [], total: 0 });
          setSearching(false);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(h);
      ctrl.abort();
    };
  }, [query, mode, patient]);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today;
  const slots = useOpenSlots(serviceId && dentistId && validDate ? { date, serviceId, dentistId } : null);
  const free = useFreeChairs(slot ? { date, start: slot.start, end: slot.end } : null);
  const effectiveChair = chairId && free.chairs?.some((c) => c.chairId === chairId) ? chairId : free.chairs?.length === 1 ? free.chairs[0].chairId : null;

  // Pre-select a start passed in the URL (e.g. from the dashboard's open times) once slots load.
  useEffect(() => {
    if (!prefillStart.current || !slots.slots) return;
    const match = slots.slots.find((s) => s.start === prefillStart.current);
    if (match) setSlot(match);
    prefillStart.current = null;
  }, [slots.slots]);

  const dentist = dentists.find((d) => d.id === dentistId);
  const notWorking = dentist && validDate && !dentist.workingDays.includes(dayOfWeek(date));

  function clearError(...keys: string[]) {
    setErrors((e) => {
      const n = { ...e };
      keys.forEach((k) => delete n[k]);
      if (Object.keys(n).length === 0) setFormError(null);
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const { fieldErrors, newPatientSchema } = await import('@/lib/validation');
    const errs: Record<string, string> = {};
    let newPatientData: NewPatient | undefined;
    if (mode === 'search' && !patient) errs.patient = 'Search and pick a patient, or add a new one';
    if (mode === 'new') {
      const p = newPatientSchema.safeParse(newPatient);
      if (!p.success) Object.entries(fieldErrors(p.error)).forEach(([k, v]) => (errs[`newPatient.${k}`] = v));
      else newPatientData = p.data;
    }
    if (!serviceId) errs.serviceId = 'Pick a service';
    if (!dentistId) errs.dentistId = 'Pick a dentist';
    if (!validDate) errs.date = 'Pick today or a later date';
    if (!slot) errs.start = 'Pick an open time';
    if (slot && !effectiveChair) errs.chairId = 'Pick a free chair';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('Please fix the highlighted fields.');
      return;
    }

    setSaving(true);
    const body = {
      ...(mode === 'search' ? { patientId: patient!.patientId } : { newPatient: newPatientData }),
      serviceId,
      dentistId,
      date,
      start: slot!.start,
      chairId: effectiveChair,
      channel,
      patientNote: note,
      ...(initial.followUpOf && mode === 'search' && patient?.patientId === initial.patient?.patientId ? { followUpOf: initial.followUpOf } : {}),
    };
    const r = await api<{ appointmentId?: number; id?: number; patientId?: number }>('/api/appointments', { body });
    setSaving(false);
    const newId = r.data.appointmentId ?? r.data.id;
    if (r.ok && newId) {
      toast.show({
        tone: 'success',
        title: 'Booking saved',
        description: `${mode === 'search' ? patient!.fullName : newPatient.fullName}, ${formatDateHuman(date)}, ${formatTime12(slot!.start)}`,
      });
      router.push(`/appointments/${newId}`);
      return;
    }
    if (r.status === 400 && r.data.issues) {
      setErrors(r.data.issues);
      setFormError(r.data.message ?? 'Please fix the highlighted fields.');
      return;
    }
    if (r.status === 409) {
      const code = r.data.error;
      if (code === 'duplicate' || code === 'duplicate_contact' || code === 'duplicate_email' || code === 'duplicate_name') {
        const field = code === 'duplicate_email' ? 'email' : code === 'duplicate_name' ? 'fullName' : 'contactNumber';
        const what = field === 'email' ? 'This email' : field === 'fullName' ? 'This name and birthdate' : 'This contact number';
        setErrors({ [`newPatient.${field}`]: r.data.message ?? 'Already used by another patient' });
        setFormError(`${what} already belongs to a patient. Search for them instead of adding a new record.`);
        return;
      }
      if (code === 'patient_same_day') {
        // One visit per patient per day: point staff at the booking that already exists.
        const other = (r.data as { existingAppointmentId?: number }).existingAppointmentId;
        setFormError(
          `${r.data.message ?? 'This patient already has a booking on that day.'} ${other ? `See appointment #${other}, or pick another date.` : 'Pick another date.'}`,
        );
        return;
      }
      setFormError(errorMessage(r, 'That time can no longer be booked.') + ' Pick another time.');
      setSlot(null);
      slots.reload();
      return;
    }
    setFormError(errorMessage(r, 'Could not save the booking.'));
  }

  /** Switch to search, pre-filled with the field that matched an existing patient. */
  function switchToExisting(field: 'contactNumber' | 'email' | 'fullName') {
    setMode('search');
    setQuery(newPatient[field]);
    clearError(`newPatient.${field}`);
    setFormError(null);
  }

  const findExisting = (field: 'contactNumber' | 'email' | 'fullName') =>
    errors[`newPatient.${field}`] && /already/i.test(errors[`newPatient.${field}`]) ? (
      <button type="button" onClick={() => switchToExisting(field)} className="mt-1 text-sm font-semibold text-brand-800 underline">
        Find the existing patient
      </button>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        {/* ---------------- Patient ---------------- */}
        <Card>
          <CardHeader
            title="1. Patient"
            description="Search by name, email, or contact number first, so the patient keeps one record."
            actions={
              !patient && (
                <div className="inline-flex rounded-lg border border-line-strong bg-white p-0.5" role="group" aria-label="Patient source">
                  {(['search', 'new'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => {
                        setMode(m);
                        clearError('patient');
                      }}
                      className={cx('h-8 rounded-md px-3 text-sm font-medium', mode === m ? 'bg-brand-700 text-white' : 'text-ink hover:bg-brand-50')}
                    >
                      {m === 'search' ? 'Existing patient' : 'New patient'}
                    </button>
                  ))}
                </div>
              )
            }
          />
          <div className="px-4 py-4 sm:px-5">
            {patient ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{patient.fullName}</p>
                  <p className="text-sm text-ink">
                    {formatContact(patient.contactNumber)}
                    {patient.email ? ` · ${patient.email}` : ''}
                    {patient.birthdate ? ` · born ${formatDateHuman(patient.birthdate)}` : ''}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPatient(null)} aria-label="Change patient">
                  <XIcon className="size-4" /> Change
                </Button>
              </div>
            ) : mode === 'search' ? (
              <div>
                <div className="relative">
                  <Input
                    label="Find patient"
                    type="text"
                    role="searchbox"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Name, email, or number"
                    autoComplete="off"
                    className="pl-10"
                    error={errors.patient ?? errors.patientId}
                    autoFocus={!initial.patient}
                  />
                  <SearchIcon className="pointer-events-none absolute top-[2.35rem] left-3 size-5 text-line-strong" />
                  {searching && <Spinner className="absolute top-[2.45rem] right-3 size-4 text-line-strong" />}
                </div>
                <div aria-live="polite">
                  {results && results.rows.length === 0 && !searching && (
                    <div className="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-muted">
                      No patient matches &ldquo;{query.trim()}&rdquo;.{' '}
                      <button
                        type="button"
                        className="font-semibold text-brand-800 underline"
                        onClick={() => {
                          setMode('new');
                          const mobile = normalizeMobile(query);
                          if (mobile) setNewPatient((p) => ({ ...p, contactNumber: cleanMobileDigits(mobile) }));
                          else if (!/\d/.test(query)) setNewPatient((p) => ({ ...p, fullName: stripNameChars(query.trim()) }));
                        }}
                      >
                        Add as new patient
                      </button>
                    </div>
                  )}
                  {results && results.rows.length > 0 && (
                    <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-lg border border-rule">
                      {results.rows.slice(0, 8).map((p) => (
                        <li key={p.patientId}>
                          <button
                            type="button"
                            onClick={() => {
                              setPatient(p);
                              clearError('patient', 'patientId');
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-brand-50 focus-visible:bg-brand-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-ink">{p.fullName}</span>
                              <span className="block truncate text-sm text-ink-muted">
                                {formatContact(p.contactNumber)}
                                {p.birthdate ? ` · born ${formatDateHuman(p.birthdate)}` : ''}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-semibold text-brand-800">Select</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {results && results.total > 8 && <p className="mt-2 text-xs text-ink-muted">Showing 8 of {results.total}. Type more to narrow it down.</p>}
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
<div>
                <Input
                  label="Full name"
                  required
                  value={newPatient.fullName}
                  onChange={(e) => setNewPatient((p) => ({ ...p, fullName: stripNameChars(e.target.value) }))}
                  error={errors['newPatient.fullName']}
                  autoComplete="off"
                />
                  {findExisting('fullName')}
                </div>
                <div>
                  <PhoneInput
                    label="Contact number"
                    required
                    value={newPatient.contactNumber}
                    onValueChange={(d) => {
                      setNewPatient((p) => ({ ...p, contactNumber: d }));
                      clearError('newPatient.contactNumber');
                    }}
                    error={errors['newPatient.contactNumber']}
                  />
                  {findExisting('contactNumber')}
                </div>
                <Input
                  label="Email"
                  optional
                  type="email"
                  value={newPatient.email}
                  onChange={(e) => setNewPatient((p) => ({ ...p, email: e.target.value }))}
                  error={errors['newPatient.email']}
                  autoComplete="off"
                  hint="Needed for the day-before reminder."
                />
                {findExisting('email')}
                <Input
                  label="Birthdate"
                  required
                  type="date"
                  max={today}
                  value={newPatient.birthdate}
                  onChange={(e) => setNewPatient((p) => ({ ...p, birthdate: e.target.value }))}
                  error={errors['newPatient.birthdate']}
                />
              </div>
            )}
          </div>
        </Card>

        {/* ---------------- Visit ---------------- */}
        <Card>
          <CardHeader title="2. Visit" description="Only open times and free chairs are shown." />
          <div className="flex flex-col gap-5 px-4 py-4 sm:px-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                wrapperClassName="sm:col-span-2"
                label="Service"
                required
                value={serviceId ?? ''}
                onChange={(e) => {
                  setServiceId(e.target.value ? Number(e.target.value) : null);
                  setSlot(null);
                  clearError('serviceId');
                }}
                error={errors.serviceId}
              >
                <option value="">Choose…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationMinutes} min)
                  </option>
                ))}
              </Select>
              <Select
                label="Dentist"
                required
                value={dentistId ?? ''}
                onChange={(e) => {
                  setDentistId(e.target.value ? Number(e.target.value) : null);
                  setSlot(null);
                  clearError('dentistId');
                }}
                error={errors.dentistId}
              >
                <option value="">Choose…</option>
                {dentists.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Date"
                type="date"
                required
                min={today}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSlot(null);
                  clearError('date');
                }}
                error={errors.date}
              />
            </div>
            <SlotPicker
              slots={slots.slots}
              state={slots.state}
              value={slot?.start ?? null}
              onChange={(s) => {
                setSlot(s);
                setChairId(null);
                clearError('start', 'chairId');
              }}
              onRetry={slots.reload}
              error={errors.start}
              emptyText={notWorking ? `${dentist?.name} does not work on that day.` : 'No open times for this dentist on that day.'}
              label={validDate ? `Open times on ${formatDateHuman(date)}` : 'Open times'}
            />
            <ChairPicker
              chairs={free.chairs}
              state={free.state}
              value={effectiveChair}
              onChange={(id) => {
                setChairId(id);
                clearError('chairId');
              }}
              onRetry={free.reload}
              error={errors.chairId}
              disabledReason={slot ? undefined : chairCount ? 'Pick a time to see free chairs.' : 'No chairs are set up yet (see Setup).'}
            />
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink">Channel</legend>
              <div className="flex flex-wrap gap-2">
                {STAFF_CHANNELS.map((c) => (
                  <label
                    key={c}
                    className={cx(
                      'flex h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium',
                      'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                      channel === c ? 'bg-brand-700 text-white' : 'bg-white text-ink ring-1 ring-line-strong hover:bg-brand-50',
                    )}
                  >
                    <input type="radio" name="channel" className="sr-only" checked={channel === c} onChange={() => setChannel(c)} />
                    {CHANNEL_LABELS[c]}
                  </label>
                ))}
              </div>
              {errors.channel && <p className="mt-1.5 text-sm text-red-700">{errors.channel}</p>}
            </fieldset>
            <Textarea label="Patient note" optional rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} error={errors.patientNote} />
          </div>
        </Card>
      </div>

      {/* ---------------- Summary ---------------- */}
      <div className="min-w-0">
        <Card className="lg:sticky lg:top-0">
          <CardHeader title="Summary" />
          <dl className="flex flex-col gap-2.5 px-4 py-4 text-sm sm:px-5">
            <Row label="Patient" value={patient?.fullName ?? (mode === 'new' && newPatient.fullName ? `${newPatient.fullName} (new)` : null)} />
            <Row label="Service" value={services.find((s) => s.id === serviceId)?.name} />
            <Row label="Dentist" value={dentist?.name} />
            <Row label="When" value={slot && validDate ? `${formatDateHuman(date)}, ${formatTime12(slot.start)} – ${formatTime12(slot.end)}` : null} />
            <Row label="Chair" value={free.chairs?.find((c) => c.chairId === effectiveChair)?.chairName} />
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Channel</dt>
              <dd>
                <ChannelBadge channel={channel} />
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-3 border-t border-rule px-4 py-4 sm:px-5">
            <FormError>{formError}</FormError>
            <Button type="submit" size="lg" className="w-full" loading={saving} loadingText="Saving…">
              <PlusIcon className="size-4" /> Save booking
            </Button>
          </div>
        </Card>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className={cx('min-w-0 text-right', value ? 'font-medium text-ink' : 'text-line-strong')}>{value || '—'}</dd>
    </div>
  );
}
