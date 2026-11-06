import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { requireStaffPage } from '@/lib/auth';
import { getDashboardSummary, getDaySchedule } from '@/lib/queries/dashboard';
import { APPOINTMENT_STATUSES, DAYS_OF_WEEK } from '@/lib/rules';
import { addDays, formatDateHuman, formatTime12, nowManila, todayManila, toMinutes } from '@/lib/time';
import type { ApptBlock, TimeRange } from '@/lib/types';
import { dashboardQuerySchema } from '@/lib/validation';
import { CHANNEL_LABEL, StatusBadge, STATUS_STYLES } from '@/components/ui/Badges';
import { ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { CalendarIcon, PlusIcon } from '@/components/ui/icons';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { DateNav } from '@/components/staff/DateNav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Schedule' };

const ROW_MINUTES = 30;
const ROW_PX = 52;

type Column = {
  key: string;
  title: string;
  subtitle?: string;
  hours?: TimeRange | null; // undefined = not a dentist column (no hours shading)
  appointments: ApptBlock[];
  muted?: boolean;
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('/dashboard');
  const sp = await searchParams;
  const parsed = dashboardQuerySchema.safeParse({
    date: typeof sp.date === 'string' && sp.date ? sp.date : undefined,
    view: sp.view === 'chair' ? 'chair' : 'dentist',
  });
  const today = todayManila();
  const date = parsed.success && parsed.data.date ? parsed.data.date : today;
  const view = parsed.success ? parsed.data.view : 'dentist';

  // Only the data section suspends, keyed by the query: a route-level loading.tsx made same-page ?date= links hang
  // (components/ui/LinkPending.tsx). The key remounts the boundary so each day shows the skeleton while it loads.
  return (
    <Suspense key={`${date}:${view}`} fallback={<PageSkeleton label="schedule" stats={3} rows={8} />}>
      <DayView date={date} view={view} today={today} />
    </Suspense>
  );
}

async function DayView({ date, view, today }: { date: string; view: 'dentist' | 'chair'; today: string }) {
  const [day, summary] = await Promise.all([getDaySchedule(date), getDashboardSummary(today)]);
  const now = nowManila();

  const columns: Column[] =
    view === 'dentist'
      ? day.dentists.map((d) => ({
          key: `d${d.dentistId}`,
          title: d.dentistName,
          subtitle: d.hours ? `${formatTime12(d.hours.start)} – ${formatTime12(d.hours.end)}` : 'Not working',
          hours: d.hours,
          appointments: d.appointments,
        }))
      : [
          ...day.chairs.map((c) => ({ key: `c${c.chairId}`, title: c.chairName, appointments: c.appointments })),
          ...(day.unassigned.length
            ? [{ key: 'none', title: 'No chair yet', subtitle: 'Pending requests', appointments: day.unassigned, muted: true }]
            : []),
        ];

  const gridStart = day.gridStart ? Math.floor(toMinutes(day.gridStart) / ROW_MINUTES) * ROW_MINUTES : null;
  const gridEnd = day.gridEnd ? Math.ceil(toMinutes(day.gridEnd) / ROW_MINUTES) * ROW_MINUTES : null;
  const totalAppts = day.dentists.reduce((n, d) => n + d.appointments.length, 0);
  const viewHref = (v: 'dentist' | 'chair') => `/dashboard?${new URLSearchParams({ date, view: v })}`;
  const isToday = date === today;

  return (
    <>
      <PageHeader
        title="Schedule"
        description={
          <>
            {DAYS_OF_WEEK[day.dayOfWeek]}, {formatDateHuman(date)}
            {isToday && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-900">Today</span>}
            {summary.pendingCount > 0 && (
              <>
                {' · '}
                <Link href="/requests" className="font-semibold text-amber-800 underline-offset-2 hover:underline">
                  {summary.pendingCount} online request{summary.pendingCount === 1 ? '' : 's'} waiting
                </Link>
              </>
            )}
          </>
        }
        actions={
          <ButtonLink href={`/appointments/new?date=${date}`} variant="primary">
            <PlusIcon className="size-4" /> New booking
          </ButtonLink>
        }
      />

      <div className="mb-6 grid grid-cols-3 divide-x divide-rule rounded-xl border border-rule bg-white">
        <SummaryCard label="Visits today" value={summary.todayTotal} hint={`${formatDateHuman(today)}, all dentists`} href={`/dashboard?date=${today}&view=${view}`} />
        <SummaryCard
          label="Requests waiting"
          value={summary.pendingCount}
          hint={summary.pendingCount ? 'Online requests to confirm or decline' : 'Nothing waiting on you'}
          href="/requests"
          tone={summary.pendingCount ? 'amber' : undefined}
        />
        <SummaryCard
          label="Tomorrow"
          value={summary.tomorrowCount}
          hint="Visits that get a reminder email"
          href={`/dashboard?date=${addDays(today, 1)}&view=${view}`}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <DateNav date={date} today={today} basePath="/dashboard" params={{ view }} />
        <div className="inline-flex rounded-[10px] border border-line-strong bg-white p-0.5" role="group" aria-label="Group schedule by">
          {(['dentist', 'chair'] as const).map((v) => (
            <Link
              key={v}
              href={viewHref(v)}
              aria-current={view === v ? 'true' : undefined}
              className={cx(
                'flex h-9 items-center rounded-md px-3.5 text-sm font-medium',
                view === v ? 'bg-brand-100 font-semibold text-brand-900' : 'text-ink hover:bg-brand-50',
              )}
            >
              By {v}
            </Link>
          ))}
        </div>
      </div>

      {gridStart === null || gridEnd === null ? (
        <Card>
          <EmptyState
            icon={<CalendarIcon />}
            title="Clinic closed"
            description={`No dentist works on ${DAYS_OF_WEEK[day.dayOfWeek]}s and nothing is booked for ${formatDateHuman(date)}.`}
          />
          {day.dentists.length > 0 && (
            <ul className="divide-y divide-rule border-t border-rule" aria-label="Dentists this day">
              {day.dentists.map((d) => (
                <li key={d.dentistId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-medium text-ink">{d.dentistName}</span>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-muted ring-1 ring-rule">Not working</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <Card className="overflow-hidden">
            {totalAppts === 0 && (
              <p className="border-b border-rule bg-canvas px-4 py-2.5 text-sm text-ink-muted" role="status">
                No appointments on this day yet. Open times are listed next to the grid.
              </p>
            )}
            <ScheduleGrid columns={columns} start={gridStart} end={gridEnd} nowMinutes={isToday ? toMinutes(now.time) : null} />
            <Legend />
          </Card>
          <OpenSlotsPanel day={day} date={date} past={date < today} />
        </div>
      )}
    </>
  );
}

function SummaryCard({ label, value, hint, href, tone }: { label: string; value: number; hint: string; href: string; tone?: 'amber' }) {
  return (
    <Link href={href} className="group px-3 py-3.5 transition-colors first:rounded-l-xl last:rounded-r-xl hover:bg-brand-50/60 sm:px-5 sm:py-4">
      <p className="text-xs leading-snug text-ink-muted sm:text-sm">{label}</p>
      <p className={cx('mt-1 text-2xl font-semibold tabular-nums sm:text-[28px] sm:leading-9', tone === 'amber' ? 'text-amber-800' : 'text-ink')}>
        {value}
      </p>
      <p className="mt-0.5 hidden truncate text-xs text-ink-muted sm:block">{hint}</p>
    </Link>
  );
}

/** Assign overlapping blocks to side-by-side lanes (only final + active rows can overlap). */
function layoutLanes(appts: ApptBlock[]): { block: ApptBlock; lane: number; lanes: number }[] {
  const sorted = [...appts].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const out: { block: ApptBlock; lane: number; lanes: number }[] = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    const n = Math.max(1, laneEnds.length);
    cluster.forEach((c) => (c.lanes = n));
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const b of sorted) {
    const s = toMinutes(b.start);
    const e = toMinutes(b.end);
    if (s >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    cluster.push({ block: b, lane, lanes: 0 });
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return out;
}

/** Stable pale tints so each dentist or chair keeps one identity across the grid (identity, not data). */
const PERSON_TINTS = ['bg-brand-100 text-brand-900', 'bg-sky-100 text-sky-900', 'bg-lime-100 text-lime-900', 'bg-orange-100 text-orange-900'];
const personInitials = (name: string) => {
  const parts = name.replace(/^Dr\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·';
};

function ScheduleGrid({ columns, start, end, nowMinutes }: { columns: Column[]; start: number; end: number; nowMinutes: number | null }) {
  const rows: number[] = [];
  for (let m = start; m < end; m += ROW_MINUTES) rows.push(m);
  const height = rows.length * ROW_PX;
  const y = (mins: number) => ((mins - start) / ROW_MINUTES) * ROW_PX;
  const fmt = (m: number) => formatTime12(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const showNow = nowMinutes !== null && nowMinutes >= start && nowMinutes <= end;

  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Day schedule, scrolls sideways on small screens">
      <div className="grid min-w-[560px]" style={{ gridTemplateColumns: `4.5rem repeat(${columns.length}, minmax(9rem, 1fr))` }}>
        {/* header row */}
        <div className="sticky left-0 z-10 border-b border-rule bg-white" />
        {columns.map((c, i) => (
          <div key={c.key} className="flex items-center gap-2.5 border-b border-l border-rule bg-white px-3 py-2.5">
            <span
              className={cx('grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold', c.muted ? 'bg-brand-50 text-ink-muted' : PERSON_TINTS[i % PERSON_TINTS.length])}
              aria-hidden="true"
            >
              {personInitials(c.title)}
            </span>
            <div className="min-w-0">
              <p className={cx('truncate text-sm font-semibold', c.muted ? 'text-ink-muted' : 'text-ink')}>{c.title}</p>
              {c.subtitle && (
                <p className={cx('truncate text-xs', c.hours === null ? 'font-medium text-ink-muted' : 'text-ink-muted')}>{c.subtitle}</p>
              )}
            </div>
          </div>
        ))}

        {/* time labels */}
        <div className="sticky left-0 z-10 bg-white" style={{ height }}>
          {showNow && (
            <span className="absolute right-0 size-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-red-500" style={{ top: y(nowMinutes!) }} aria-hidden="true" />
          )}
          {rows.map((m) => (
            <div key={m} className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-ink-muted tabular-nums" style={{ top: y(m) + (m === start ? 8 : 0) }}>
              {fmt(m)}
            </div>
          ))}
        </div>

        {columns.map((c) => {
          const hoursStart = c.hours ? toMinutes(c.hours.start) : null;
          const hoursEnd = c.hours ? toMinutes(c.hours.end) : null;
          return (
            <div key={c.key} className={cx('relative border-l border-rule', c.muted && 'bg-canvas/60')} style={{ height }}>
              {/* row lines */}
              {rows.map((m) => (
                <div
                  key={m}
                  className={cx('absolute inset-x-0 border-t', m % 60 === 0 ? 'border-rule' : 'border-dashed border-rule')}
                  style={{ top: y(m) }}
                />
              ))}
              {/* outside working hours / not working */}
              {c.hours === null && (
                <div className="absolute inset-0 grid place-items-center bg-brand-50">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-muted ring-1 ring-rule">Not working</span>
                </div>
              )}
              {hoursStart !== null && hoursStart > start && (
                <div className="absolute inset-x-0 top-0 bg-brand-50/80" style={{ height: y(hoursStart) }} aria-hidden="true" />
              )}
              {hoursEnd !== null && hoursEnd < end && (
                <div className="absolute inset-x-0 bottom-0 bg-brand-50/80" style={{ top: y(hoursEnd) }} aria-hidden="true" />
              )}
              {showNow && (
                <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-red-500" style={{ top: y(nowMinutes!) }} aria-hidden="true" />
              )}
              {/* appointments */}
              {layoutLanes(c.appointments).map(({ block: a, lane, lanes }) => {
                const top = y(toMinutes(a.start));
                const h = Math.max(y(toMinutes(a.end)) - top, 26);
                const style = STATUS_STYLES[a.status];
                const compact = h < 60;
                return (
                  <Link
                    key={a.appointmentId}
                    href={`/appointments/${a.appointmentId}`}
                    className={cx(
                      'absolute overflow-hidden rounded-md border px-2 py-1 text-xs transition-colors',
                      style.block,
                      a.status === 'cancelled' && 'opacity-70',
                    )}
                    style={{
                      top: top + 1,
                      height: h - 3,
                      left: `calc(${(lane / lanes) * 100}% + 4px)`,
                      width: `calc(${100 / lanes}% - 8px)`,
                    }}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className="truncate font-semibold">{a.patientName}</span>
                      {a.status === 'pending' && <span className="shrink-0 rounded bg-amber-200/80 px-1 text-[10px] font-bold uppercase">Pending</span>}
                      {a.status === 'no-show' && <span className="shrink-0 rounded bg-red-700 px-1 text-[10px] font-bold text-white uppercase">No-show</span>}
                      {a.status === 'attended' && <span className="shrink-0 text-[10px] font-bold text-green-800 uppercase">Attended</span>}
                    </span>
                    <span className="block truncate opacity-90">
                      {formatTime12(a.start)}
                      {compact ? ` · ${a.serviceName}` : ` – ${formatTime12(a.end)}`}
                    </span>
                    {!compact && <span className="block truncate opacity-90">{a.serviceName}</span>}
                    {!compact && h >= 80 && <span className="block truncate text-[10px] font-medium opacity-75">via {CHANNEL_LABEL[a.channel]}</span>}
                    {/* The link's name is its visible text; status and channel are added for screen readers. */}
                    <span className="sr-only">
                      , {a.status}, booked by {CHANNEL_LABEL[a.channel].toLowerCase()}
                    </span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3">
      <span className="text-xs font-medium text-ink-muted">Status:</span>
      {APPOINTMENT_STATUSES.filter((s) => s !== 'declined' && s !== 'cancelled').map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
      <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted">
        <span className="inline-block h-3 w-5 rounded-sm bg-brand-50 ring-1 ring-rule" /> outside working hours
      </span>
    </div>
  );
}

function OpenSlotsPanel({ day, date, past }: { day: Awaited<ReturnType<typeof getDaySchedule>>; date: string; past: boolean }) {
  return (
    <Card as="div" className="h-fit">
      <div className="border-b border-rule px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Open times</h2>
        <p className="text-xs text-ink-muted">Starts where a {day.slotDurationMinutes}-minute visit fits. Click to book.</p>
      </div>
      <div className="divide-y divide-rule">
        {day.dentists.map((d) => (
          <div key={d.dentistId} className="px-4 py-3">
            <p className="mb-2 flex items-baseline justify-between gap-2 text-sm font-medium text-ink">
              {d.dentistName}
              <span className="text-xs font-normal text-ink-muted">{d.hours && !past ? `${d.openSlots.length} open` : ''}</span>
            </p>
            {!d.hours ? (
              <p className="text-sm text-ink-muted">Not working</p>
            ) : past ? (
              <p className="text-sm text-ink-muted">This day has passed</p>
            ) : d.openSlots.length === 0 ? (
              <p className="text-sm text-ink-muted">No open times left</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {d.openSlots.map((s) => (
                  <li key={s.start}>
                    <Link
                      href={`/appointments/new?${new URLSearchParams({
                        date,
                        dentistId: String(d.dentistId),
                        start: s.start,
                        ...(day.slotServiceId ? { serviceId: String(day.slotServiceId) } : {}),
                      })}`}
                      className="inline-flex h-8 items-center rounded-md bg-brand-50 px-2 text-xs font-semibold text-brand-800 tabular-nums ring-1 ring-brand-200 hover:bg-brand-100"
                    >
                      {formatTime12(s.start)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
