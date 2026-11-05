import { cx } from './cx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-brand-100/70', className)} aria-hidden="true" />;
}
