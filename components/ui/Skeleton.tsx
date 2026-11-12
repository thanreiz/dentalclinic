import { cx } from './cx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-brand-100/70', className)} aria-hidden="true" />;
}

/** Grey placeholder block for Suspense fallbacks. Decorative: the wrapper carries the status. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-brand-100/70 motion-reduce:animate-none', className)} aria-hidden="true" />;
}

/** Page-shaped skeleton: a header, optional stat row, then `rows` list rows. Announced once as "Loading". */
export function PageSkeleton({ label, stats = 0, rows = 6 }: { label: string; stats?: number; rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="motion-fade">
      <span className="sr-only">Loading {label}</span>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <SkeletonBlock className="h-7 w-48" />
          <SkeletonBlock className="h-4 w-72 max-w-full" />
        </div>
        <SkeletonBlock className="hidden h-10 w-36 sm:block" />
      </div>
      {stats > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <SkeletonBlock key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonBlock key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
