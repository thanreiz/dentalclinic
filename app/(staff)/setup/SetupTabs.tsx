'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type KeyboardEvent } from 'react';
import { DAYS_OF_WEEK } from '@/lib/rules';
import { formatTime12, toMinutes } from '@/lib/time';
import type { ChairItem, DentistWithSchedules, ServiceItem } from '@/lib/types';
import { api, errorMessage, type ApiResult } from '@/components/api';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError, Input } from '@/components/ui/Field';
import { CogIcon, PlusIcon, UsersIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';

export type SetupTab = 'dentists' | 'services' | 'chairs';
const TABS: { id: SetupTab; label: string }[] = [
  { id: 'dentists', label: 'Dentists' },
  { id: 'services', label: 'Services' },
  { id: 'chairs', label: 'Chairs' },
];
const IN_USE = 'In use by existing appointments';

function deleteMessage(r: ApiResult<unknown>): string {
  if (r.status === 409) return r.data.message || IN_USE;
  return errorMessage(r, 'Could not delete.');
}

export default function SetupTabs({
  initialTab,
  dentists,
  services,
  chairs,
}: {
  initialTab: SetupTab;
  dentists: DentistWithSchedules[];
  services: ServiceItem[];
  chairs: ChairItem[];
}) {
  const [tab, setTab] = useState<SetupTab>(initialTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(t: SetupTab) {
    setTab(t);
    window.history.replaceState(null, '', `/setup?tab=${t}`);
  }

  function onKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    select(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  const counts = { dentists: dentists.length, services: services.length, chairs: chairs.length };

  return (
    <div>
      <div role="tablist" aria-label="Setup sections" className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              '-mb-px flex h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium',
              tab === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {t.label}
            <span className={cx('rounded-full px-1.5 text-xs tabular-nums', tab === t.id ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-slate-600')}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'dentists' && <DentistsPanel dentists={dentists} />}
        {tab === 'services' && <ServicesPanel services={services} />}
        {tab === 'chairs' && <ChairsPanel chairs={chairs} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dentists + weekly hours
// ---------------------------------------------------------------------------

type WeekRow = { start: string; end: string };
const emptyWeek = (): WeekRow[] => Array.from({ length: 7 }, () => ({ start: '', end: '' }));

function summarizeWeek(week: (WeekRow | { start: string; end: string } | null)[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    const w = week[i];
    if (!w || !w.start) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && week[j + 1]?.start === w.start && week[j + 1]?.end === w.end) j++;
    const days = i === j ? DAYS_OF_WEEK[i].slice(0, 3) : `${DAYS_OF_WEEK[i].slice(0, 3)}–${DAYS_OF_WEEK[j].slice(0, 3)}`;
    parts.push(`${days} ${formatTime12(w.start)}–${formatTime12(w.end)}`);
    i = j + 1;
  }
  return parts.length ? parts.join(', ') : 'No working hours (never bookable)';
}

function DentistsPanel({ dentists }: { dentists: DentistWithSchedules[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<DentistWithSchedules | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  async function doDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const r = await api(`/api/setup/dentists?id=${toDelete.dentistId}`, { method: 'DELETE', body: { id: toDelete.dentistId } });
    setDeleting(false);
    const d = toDelete;
    setToDelete(null);
    if (r.ok) {
      toast.show({ tone: 'success', title: `${d.dentistName} removed` });
      router.refresh();
    } else {
      setRowError({ id: d.dentistId, message: deleteMessage(r) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {editing !== 'new' && (
          <Button onClick={() => setEditing('new')}>
            <PlusIcon className="size-4" /> Add dentist
          </Button>
        )}
      </div>
      {editing === 'new' && <DentistEditor onDone={() => setEditing(null)} />}
      {dentists.length === 0 && editing !== 'new' && (
        <Card>
          <EmptyState icon={<UsersIcon />} title="No dentists yet" description="Add a dentist and their weekly hours so patients can book." />
        </Card>
      )}
      {dentists.map((d) =>
        editing === d.dentistId ? (
          <DentistEditor key={d.dentistId} dentist={d} onDone={() => setEditing(null)} />
        ) : (
          <Card key={d.dentistId}>
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-900">{d.dentistName}</p>
                <p className="mt-0.5 text-sm text-slate-600">{summarizeWeek(d.week)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {d.appointmentCount} appointment{d.appointmentCount === 1 ? '' : 's'} on record
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setRowError(null);
                    setEditing(d.dentistId);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="dangerGhost"
                  size="sm"
                  onClick={() => {
                    setRowError(null);
                    setToDelete(d);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            <WeekStrip week={d.week} />
            {rowError?.id === d.dentistId && <FormError className="mx-4 mb-4 sm:mx-5">{rowError.message}</FormError>}
          </Card>
        ),
      )}
      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.dentistName ?? ''}?`}
        description="This removes the dentist and their working hours. A dentist with appointments on record cannot be deleted."
        confirmLabel="Delete dentist"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function WeekStrip({ week }: { week: ({ start: string; end: string } | null)[] }) {
  return (
    <div className="grid grid-cols-7 border-t border-slate-100 text-center text-xs">
      {DAYS_OF_WEEK.map((day, i) => {
        const w = week[i];
        return (
          <div key={day} className={cx('px-1 py-2', i > 0 && 'border-l border-slate-100', !w && 'bg-slate-50')}>
            <p className="font-semibold text-slate-700">{day.slice(0, 3)}</p>
            {w ? (
              <p className="mt-0.5 text-slate-600 tabular-nums">
                <span className="block">{formatTime12(w.start)}</span>
                <span className="block">{formatTime12(w.end)}</span>
              </p>
            ) : (
              <p className="mt-0.5 text-slate-400">Off</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DentistEditor({ dentist, onDone }: { dentist?: DentistWithSchedules; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(dentist?.dentistName ?? '');
  const [week, setWeek] = useState<WeekRow[]>(
    dentist ? dentist.week.map((w) => (w ? { start: w.start, end: w.end } : { start: '', end: '' })) : emptyWeek(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setRow(i: number, patch: Partial<WeekRow>) {
    setWeek((w) => w.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setErrors((e) => {
      const n = { ...e };
      delete n[`day${i}`];
      return n;
    });
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.dentistName = 'Enter the dentist name (2+ characters)';
    week.forEach((r, i) => {
      if (!r.start && !r.end) return;
      if (!r.start || !r.end) errs[`day${i}`] = 'Fill both times, or clear both for a day off';
      else if (toMinutes(r.end) <= toMinutes(r.start)) errs[`day${i}`] = 'End time must be after start time';
    });
    return errs;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const schedules = week
      .map((r, i) => ({ dayOfWeek: i, startTime: r.start.slice(0, 5), endTime: r.end.slice(0, 5) }))
      .filter((r) => r.startTime && r.endTime);
    const body = dentist ? { id: dentist.dentistId, dentistName: name.trim(), schedules } : { dentistName: name.trim(), schedules };
    setSaving(true);
    const r = await api('/api/setup/dentists', { method: dentist ? 'PATCH' : 'POST', body });
    setSaving(false);
    if (r.ok) {
      toast.show({ tone: 'success', title: dentist ? 'Dentist updated' : 'Dentist added', description: summarizeWeek(week) });
      router.refresh();
      onDone();
      return;
    }
    if (r.status === 400 && r.data.issues) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.data.issues)) {
        const m = /^schedules\.(\d+)/.exec(k);
        if (m) mapped[`day${schedules[Number(m[1])]?.dayOfWeek ?? 0}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
    }
    setFormError(errorMessage(r, 'Could not save the dentist.'));
  }

  return (
    <Card className="ring-2 ring-brand-600/30">
      <CardHeader title={dentist ? `Edit ${dentist.dentistName}` : 'New dentist'} description="Leave both times blank for a day off. One time range per day." />
      <form onSubmit={save} noValidate className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.dentistName} placeholder="Dr. Santos" maxLength={100} wrapperClassName="max-w-sm" autoFocus />
        <fieldset>
          <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium text-slate-800">
            Weekly hours
            <span className="flex gap-1.5">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
                onClick={() => setWeek(week.map((_, i) => (i >= 1 && i <= 6 ? { start: '09:00', end: '17:00' } : { start: '', end: '' })))}
              >
                Mon–Sat 9–5
              </button>
              <button type="button" className="rounded-md px-2 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50" onClick={() => setWeek(emptyWeek())}>
                Clear all
              </button>
            </span>
          </legend>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {DAYS_OF_WEEK.map((day, i) => {
              const r = week[i];
              const off = !r.start && !r.end;
              const err = errors[`day${i}`];
              return (
                <div key={day} className={cx('grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[7rem_1fr_auto]', i > 0 && 'border-t border-slate-100', err && 'bg-red-50/60')}>
                  <span className="text-sm font-medium text-slate-800">{day}</span>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`d-${i}-start`}>
                      {day} start time
                    </label>
                    <input
                      id={`d-${i}-start`}
                      type="time"
                      step={1800}
                      value={r.start}
                      onChange={(e) => setRow(i, { start: e.target.value })}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `d-${i}-err` : undefined}
                      className="h-10 w-32 rounded-md border border-slate-300 px-2 text-sm tabular-nums focus:border-brand-600 focus:ring-2 focus:ring-brand-600/40 focus:outline-none"
                    />
                    <span className="text-slate-400" aria-hidden="true">
                      to
                    </span>
                    <label className="sr-only" htmlFor={`d-${i}-end`}>
                      {day} end time
                    </label>
                    <input
                      id={`d-${i}-end`}
                      type="time"
                      step={1800}
                      value={r.end}
                      onChange={(e) => setRow(i, { end: e.target.value })}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `d-${i}-err` : undefined}
                      className="h-10 w-32 rounded-md border border-slate-300 px-2 text-sm tabular-nums focus:border-brand-600 focus:ring-2 focus:ring-brand-600/40 focus:outline-none"
                    />
                  </div>
                  <div className="col-start-2 sm:col-start-3">
                    {off ? (
                      <span className="text-xs font-medium text-slate-500">Off</span>
                    ) : (
                      <button type="button" className="text-xs font-semibold text-slate-600 underline hover:text-slate-900" onClick={() => setRow(i, { start: '', end: '' })}>
                        Set off
                      </button>
                    )}
                  </div>
                  {err && (
                    <p id={`d-${i}-err`} className="col-span-full text-sm text-red-700" role="alert">
                      {err}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
        <FormError>{formError}</FormError>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} loadingText="Saving…">
            {dentist ? 'Save changes' : 'Add dentist'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Services and chairs: simple inline-editable lists
// ---------------------------------------------------------------------------

function ServicesPanel({ services }: { services: ServiceItem[] }) {
  return (
    <SimpleEntityPanel
      entity="services"
      singular="service"
      items={services.map((s) => ({ id: s.serviceId, name: s.serviceName, duration: String(s.durationMinutes), count: s.appointmentCount }))}
      withDuration
    />
  );
}

function ChairsPanel({ chairs }: { chairs: ChairItem[] }) {
  return <SimpleEntityPanel entity="chairs" singular="chair" items={chairs.map((c) => ({ id: c.chairId, name: c.chairName, duration: '', count: c.appointmentCount }))} />;
}

type SimpleItem = { id: number; name: string; duration: string; count: number };

function SimpleEntityPanel({ entity, singular, items, withDuration = false }: { entity: 'services' | 'chairs'; singular: string; items: SimpleItem[]; withDuration?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<SimpleItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  async function doDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const r = await api(`/api/setup/${entity}?id=${toDelete.id}`, { method: 'DELETE', body: { id: toDelete.id } });
    setDeleting(false);
    const it = toDelete;
    setToDelete(null);
    if (r.ok) {
      toast.show({ tone: 'success', title: `${it.name} removed` });
      router.refresh();
    } else {
      setRowError({ id: it.id, message: deleteMessage(r) });
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={withDuration ? 'Services' : 'Chairs'}
        description={withDuration ? 'Duration sets the end time and which open times fit.' : 'Every confirmed or staff booking takes exactly one free chair.'}
        actions={
          editing !== 'new' && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <PlusIcon className="size-4" /> Add {singular}
            </Button>
          )
        }
      />
      {editing === 'new' && (
        <div className="border-b border-slate-100 bg-brand-50/40">
          <SimpleEditor entity={entity} singular={singular} withDuration={withDuration} onDone={() => setEditing(null)} />
        </div>
      )}
      {items.length === 0 && editing !== 'new' ? (
        <EmptyState icon={<CogIcon />} title={`No ${entity} yet`} description={`Add a ${singular} to start booking.`} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={it.id}>
              {editing === it.id ? (
                <SimpleEditor entity={entity} singular={singular} withDuration={withDuration} item={it} onDone={() => setEditing(null)} />
              ) : (
                <div className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {it.name}
                        {withDuration && <span className="ml-2 text-sm font-normal text-slate-600">{it.duration} min</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {it.count} appointment{it.count === 1 ? '' : 's'} on record
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setRowError(null);
                          setEditing(it.id);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="dangerGhost"
                        size="sm"
                        onClick={() => {
                          setRowError(null);
                          setToDelete(it);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {rowError?.id === it.id && <FormError className="mt-2">{rowError.message}</FormError>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.name ?? ''}?`}
        description={`A ${singular} used by existing appointments cannot be deleted.`}
        confirmLabel={`Delete ${singular}`}
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </Card>
  );
}

function SimpleEditor({
  entity,
  singular,
  withDuration,
  item,
  onDone,
}: {
  entity: 'services' | 'chairs';
  singular: string;
  withDuration: boolean;
  item?: SimpleItem;
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [duration, setDuration] = useState(item?.duration ?? '30');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameKey = entity === 'services' ? 'serviceName' : 'chairName';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    const minName = entity === 'services' ? 2 : 1;
    if (name.trim().length < minName) errs[nameKey] = `Enter a name${minName > 1 ? ' (2+ characters)' : ''}`;
    const dur = Number(duration);
    if (withDuration && (!Number.isInteger(dur) || dur < 5 || dur > 480)) errs.durationMinutes = 'Whole minutes from 5 to 480';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body: Record<string, unknown> = { [nameKey]: name.trim() };
    if (withDuration) body.durationMinutes = dur;
    if (item) body.id = item.id;
    setSaving(true);
    const r = await api(`/api/setup/${entity}`, { method: item ? 'PATCH' : 'POST', body });
    setSaving(false);
    if (r.ok) {
      toast.show({ tone: 'success', title: item ? `${singular[0].toUpperCase()}${singular.slice(1)} updated` : `${singular[0].toUpperCase()}${singular.slice(1)} added` });
      router.refresh();
      onDone();
      return;
    }
    if (r.status === 400 && r.data.issues) setErrors(r.data.issues);
    else if (r.status === 409) setErrors({ [nameKey]: r.data.message === 'That value is already used' ? `A ${singular} with that name already exists` : (r.data.message ?? 'Already exists') });
    else setFormError(errorMessage(r, `Could not save the ${singular}.`));
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start gap-3">
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors[nameKey]}
          maxLength={entity === 'services' ? 100 : 50}
          wrapperClassName="min-w-56 flex-1"
          placeholder={entity === 'services' ? 'e.g. Root canal' : 'e.g. Chair 3'}
          autoFocus
        />
        {withDuration && (
          <Input
            label="Duration (minutes)"
            required
            type="number"
            inputMode="numeric"
            min={5}
            max={480}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            error={errors.durationMinutes}
            wrapperClassName="w-44"
          />
        )}
      </div>
      <FormError>{formError}</FormError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={saving}>
          {item ? 'Save' : `Add ${singular}`}
        </Button>
      </div>
    </form>
  );
}
