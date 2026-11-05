import Image from 'next/image';
import { cx } from './cx';

/** Molar & Co. icon: the molar mark alone (avatars, tight spaces). SVG paths, no font needed. */
export function BrandIcon({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  return (
    <Image
      src={`/brand/molar-co-icon-${tone}.svg`}
      alt=""
      width={140}
      height={150}
      unoptimized
      priority
      className={cx('w-auto select-none', className)}
    />
  );
}

/** Molar & Co. lockup: mark + wordmark. Use the light file on light grounds. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/molar-co-lockup-light.svg"
      alt="Molar & Co."
      width={411}
      height={160}
      unoptimized
      priority
      className={cx('w-auto select-none', className)}
    />
  );
}
