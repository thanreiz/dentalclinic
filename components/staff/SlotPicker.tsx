'use client';

import type { Slot } from '@/lib/types';
import { formatTime12 } from '@/lib/time';
import { cx } from '@/components/ui/cx';

/** Grid of open start times as a radio group. */
export function SlotPicker({
  slots,
  state,
  value,
  onChange,
  onRetry,
  label = 'Open times',
  error,
  emptyText = 'No open times on this day.',
  name = 'slot',
}: {
  slots: Slot[] | null;
  state: 'idle' | 'loading' | 'error';
  value: string | null;
  onChange: (slot: Slot) => void;
  onRetry?: () => void;
  label?: string;
  error?: string | null;
  emptyText?: string;
  name?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
      <div aria-live="polite">
        {state === 'loading' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-1.5" aria-label="Loading open times">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-brand-100/70" />
            ))}
          </div>
        )}
        {state === 'error' && (
          <p className="text-sm text-red-700">
            Could not load open times.{' '}
            {onRetry && (
              <button type="button" onClick={onRetry} className="font-semibold underline">
                Retry
              </button>
            )}
          </p>
        )}
        {state === 'idle' && slots === null && <p className="text-sm text-ink-muted">Pick the options above to see open times.</p>}
        {state === 'idle' && slots && slots.length === 0 && (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-2.5 text-sm text-ink-muted">{emptyText}</p>
        )}
      </div>
      {state === 'idle' && slots && slots.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-1.5">
          {slots.map((s) => {
            const checked = value === s.start;
            return (
              <label
                key={s.start}
                className={cx(
                  'flex h-10 cursor-pointer items-center justify-center rounded-md text-sm font-semibold tabular-nums transition-colors',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                  checked ? 'bg-brand-700 text-white' : 'bg-white text-ink ring-1 ring-line-strong hover:bg-brand-50 hover:ring-brand-400',
                )}
              >
                <input type="radio" name={name} value={s.start} aria-label={formatTime12(s.start)} className="sr-only" checked={checked} onChange={() => onChange(s)} />
                {formatTime12(s.start)}
              </label>
            );
          })}
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
