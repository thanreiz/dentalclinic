'use client';

import { useState } from 'react';
import { addDays, dayOfWeek, monthRange } from '@/lib/time';
import { cx } from '@/components/ui/cx';
import { ChevronLeft, ChevronRight } from '@/components/ui/icons';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = [
  ['S', 'Sunday'],
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
] as const;

function shiftMonth(month: string, delta: number): string {
  let [y, m] = month.split('-').map(Number);
  m += delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

type Props = {
  value: string | null;
  onChange: (date: string) => void;
  /** Inclusive 'YYYY-MM-DD' bounds. */
  min: string;
  max: string;
  today: string;
  isEnabled?: (date: string) => boolean;
  labelledBy?: string;
};

/** Month grid date picker: 7 columns of 44px+ tap targets, fits a 360px screen. */
export function DateCalendar({ value, onChange, min, max, today, isEnabled, labelledBy }: Props) {
  const [month, setMonth] = useState((value ?? min).slice(0, 7));
  const first = `${month}-01`;
  const offset = dayOfWeek(first);
  const daysInMonth = Number(monthRange(month).last.slice(8));
  const [y, m] = month.split('-').map(Number);
  const canPrev = month > min.slice(0, 7);
  const canNext = month < max.slice(0, 7);

  const cells: (string | null)[] = [...Array(offset).fill(null)];
  for (let d = 0; d < daysInMonth; d++) cells.push(addDays(first, d));

  return (
    <div className="select-none" role="group" aria-labelledby={labelledBy}>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          disabled={!canPrev}
          className="grid size-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-5" />
        </button>
        <p className="text-base font-semibold text-slate-900" aria-live="polite">
          {MONTHS[m - 1]} {y}
        </p>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={!canNext}
          className="grid size-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next month"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map(([short, long]) => (
          <abbr key={long} title={long} className="pb-1 text-xs font-medium text-slate-500 no-underline">
            {short}
          </abbr>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} aria-hidden="true" />;
          const inRange = date >= min && date <= max;
          const enabled = inRange && (isEnabled ? isEnabled(date) : true);
          const selected = date === value;
          const isToday = date === today;
          const dayNum = Number(date.slice(8));
          return (
            <button
              key={date}
              type="button"
              disabled={!enabled}
              aria-pressed={selected}
              aria-label={`${WEEKDAYS[dayOfWeek(date)][1]}, ${MONTHS[m - 1]} ${dayNum}, ${y}${isToday ? ' (today)' : ''}${
                inRange && !enabled ? ', closed' : ''
              }`}
              onClick={() => onChange(date)}
              className={cx(
                'relative h-11 rounded-lg text-sm font-medium tabular-nums transition-colors',
                selected
                  ? 'bg-brand-700 text-white shadow-sm'
                  : enabled
                    ? 'bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-brand-50 hover:ring-brand-300'
                    : 'cursor-not-allowed text-slate-300',
              )}
            >
              {dayNum}
              {isToday && (
                <span
                  aria-hidden="true"
                  className={cx('absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full', selected ? 'bg-white' : 'bg-brand-600')}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
