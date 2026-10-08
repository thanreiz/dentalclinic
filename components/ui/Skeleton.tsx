import { cx } from './cx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden="true" />;
}

/** Generic page skeleton for loading.tsx files. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={cx('h-5', i > 0 && 'mt-4', i % 3 === 2 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}
