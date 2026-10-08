'use client';

import { cx } from '@/components/ui/cx';
import type { FreeChair } from './hooks';

/** Free chairs only (Rule 6); exactly one must be picked. */
export function ChairPicker({
  chairs,
  state,
  value,
  onChange,
  onRetry,
  error,
  disabledReason,
  name = 'chair',
}: {
  chairs: FreeChair[] | null;
  state: 'idle' | 'loading' | 'error';
  value: number | null;
  onChange: (id: number) => void;
  onRetry?: () => void;
  error?: string | null;
  disabledReason?: string;
  name?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-800">Chair (free at that time)</legend>
      <div aria-live="polite">
        {disabledReason && <p className="text-sm text-slate-500">{disabledReason}</p>}
        {!disabledReason && state === 'loading' && <div className="h-10 w-full animate-pulse rounded-md bg-slate-200/70" />}
        {!disabledReason && state === 'error' && (
          <p className="text-sm text-red-700">
            Could not load chairs.{' '}
            {onRetry && (
              <button type="button" className="font-semibold underline" onClick={onRetry}>
                Retry
              </button>
            )}
          </p>
        )}
        {!disabledReason && state === 'idle' && chairs && chairs.length === 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">No chair is free at that time.</p>
        )}
      </div>
      {!disabledReason && state === 'idle' && chairs && chairs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chairs.map((c) => {
            const checked = value === c.chairId;
            return (
              <label
                key={c.chairId}
                className={cx(
                  'flex h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                  checked ? 'bg-brand-700 text-white shadow-sm' : 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-brand-50',
                )}
              >
                <input type="radio" name={name} value={c.chairId} aria-label={c.chairName} className="sr-only" checked={checked} onChange={() => onChange(c.chairId)} />
                {c.chairName}
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
