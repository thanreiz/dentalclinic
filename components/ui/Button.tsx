import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cx } from './cx';
import { Spinner } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dangerGhost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 disabled:bg-brand-100 disabled:text-ink-muted disabled:opacity-100',
  secondary: 'border border-line-strong bg-white text-ink hover:bg-brand-50 hover:border-brand-200 active:bg-brand-50',
  ghost: 'text-ink hover:bg-brand-50 active:bg-brand-100',
  dangerGhost: 'text-red-700 hover:bg-red-50 active:bg-red-100',
  danger: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-900',
  success: 'bg-green-700 text-white hover:bg-green-800 active:bg-green-900',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cx(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
};

/** Button with variants and a loading state (disabled + spinner + aria-busy). */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

/** A Next.js Link styled as a button. */
export function ButtonLink({ variant = 'secondary', size = 'md', className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...rest} />;
}
