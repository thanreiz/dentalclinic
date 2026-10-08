'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addDays } from '@/lib/time';
import { buttonClasses } from '@/components/ui/Button';
import { ChevronLeft, ChevronRight } from '@/components/ui/icons';
import { LinkPendingIcon } from '@/components/ui/LinkPending';

/** Prev / date input / next / Today. Keeps other query params (e.g. view). */
export function DateNav({ date, today, basePath, params = {} }: { date: string; today: string; basePath: string; params?: Record<string, string> }) {
  const router = useRouter();
  const href = (d: string) => `${basePath}?${new URLSearchParams({ ...params, date: d })}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-sm">
        <Link href={href(addDays(date, -1))} className="grid size-10 place-items-center rounded-l-lg text-slate-700 hover:bg-slate-50" aria-label="Previous day">
          <LinkPendingIcon>
            <ChevronLeft className="size-5" />
          </LinkPendingIcon>
        </Link>
        <label className="sr-only" htmlFor="dash-date">
          Day
        </label>
        <input
          id="dash-date"
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) router.push(href(e.target.value));
          }}
          className="h-10 border-x border-slate-200 px-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
        />
        <Link href={href(addDays(date, 1))} className="grid size-10 place-items-center rounded-r-lg text-slate-700 hover:bg-slate-50" aria-label="Next day">
          <LinkPendingIcon>
            <ChevronRight className="size-5" />
          </LinkPendingIcon>
        </Link>
      </div>
      {date !== today && (
        <Link href={href(today)} className={buttonClasses('secondary', 'sm', 'h-10')}>
          Today
        </Link>
      )}
    </div>
  );
}
