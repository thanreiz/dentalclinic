'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@/components/ui/icons';
import { LinkPendingIcon } from '@/components/ui/LinkPending';

function shift(month: string, delta: number) {
  let [y, m] = month.split('-').map(Number);
  m += delta;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

const href = (month: string, threshold: number) => `/reports?${new URLSearchParams({ month, threshold: String(threshold) })}`;

/** Month picker: prev / month input / next (?month=YYYY-MM). */
export default function ReportControls({ month, threshold }: { month: string; threshold: number }) {
  const router = useRouter();
  return (
    <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-sm">
      <Link href={href(shift(month, -1), threshold)} className="grid size-10 place-items-center rounded-l-lg text-slate-700 hover:bg-slate-50" aria-label="Previous month">
        <LinkPendingIcon>
          <ChevronLeft className="size-5" />
        </LinkPendingIcon>
      </Link>
      <label htmlFor="report-month" className="sr-only">
        Month
      </label>
      <input
        id="report-month"
        type="month"
        value={month}
        onChange={(e) => {
          if (/^\d{4}-\d{2}$/.test(e.target.value)) router.push(href(e.target.value, threshold));
        }}
        className="h-10 border-x border-slate-200 px-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
      />
      <Link href={href(shift(month, 1), threshold)} className="grid size-10 place-items-center rounded-r-lg text-slate-700 hover:bg-slate-50" aria-label="Next month">
        <LinkPendingIcon>
          <ChevronRight className="size-5" />
        </LinkPendingIcon>
      </Link>
    </div>
  );
}

/** Threshold number input (?threshold=); applies after a short pause. */
export function ThresholdInput({ month, threshold }: { month: string; threshold: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(threshold));
  useEffect(() => setValue(String(threshold)), [threshold]);
  useEffect(() => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 100 || n === threshold) return;
    const h = setTimeout(() => router.replace(href(month, n), { scroll: false }), 400);
    return () => clearTimeout(h);
  }, [value, threshold, month, router]);
  const invalid = value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 100);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="threshold" className="text-sm font-medium text-slate-700">
        Threshold
      </label>
      <input
        id="threshold"
        type="number"
        min={1}
        max={100}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'threshold-error' : undefined}
        className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-sm tabular-nums focus:border-brand-600 focus:ring-2 focus:ring-brand-600/40 focus:outline-none aria-[invalid]:border-red-600"
      />
      {invalid && (
        <span id="threshold-error" className="text-xs text-red-700" role="alert">
          1–100
        </span>
      )}
    </div>
  );
}
