'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { cx } from './cx';

export const controlBase =
  'block w-full rounded-lg border bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 ' +
  'transition-colors focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-brand-600/40 focus:border-brand-600 ' +
  'disabled:bg-slate-100 disabled:text-slate-500 sm:text-sm';

const controlState = (invalid: boolean) => (invalid ? 'border-red-600 focus:ring-red-600/30 focus:border-red-600' : 'border-slate-300');

type FieldShellProps = {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label + control + hint + inline error, wired with aria-describedby. */
function FieldShell({ id, label, error, hint, required, optional, className, children }: FieldShellProps) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
        {required && (
          <span className="ml-0.5 text-red-700" aria-hidden="true">
            *
          </span>
        )}
        {optional && <span className="ml-1.5 font-normal text-slate-500">(optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string | null, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type CommonProps = {
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  wrapperClassName?: string;
};

export function Input({ label, error, hint, optional, wrapperClassName, className, id, required, ...rest }: CommonProps & ComponentProps<'input'>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} error={error} hint={hint} required={required} optional={optional} className={wrapperClassName}>
      <input
        id={fid}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, error, hint)}
        className={cx(controlBase, controlState(!!error), 'h-11', className)}
        {...rest}
      />
    </FieldShell>
  );
}

export function Select({ label, error, hint, optional, wrapperClassName, className, id, required, children, ...rest }: CommonProps & ComponentProps<'select'>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} error={error} hint={hint} required={required} optional={optional} className={wrapperClassName}>
      <select
        id={fid}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, error, hint)}
        className={cx(controlBase, controlState(!!error), 'h-11 pr-8', className)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function Textarea({ label, error, hint, optional, wrapperClassName, className, id, required, ...rest }: CommonProps & ComponentProps<'textarea'>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} error={error} hint={hint} required={required} optional={optional} className={wrapperClassName}>
      <textarea
        id={fid}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, error, hint)}
        className={cx(controlBase, controlState(!!error), 'min-h-24 py-2.5', className)}
        {...rest}
      />
    </FieldShell>
  );
}

type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode; error?: string | null };

/** Large-tap-target checkbox with its label to the right. */
export function Checkbox({ label, error, id, className, ...rest }: CheckboxProps) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={fid}
        className={cx(
          'flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 text-sm leading-relaxed text-slate-800',
          error ? 'border-red-600' : 'border-slate-300 hover:border-slate-400',
        )}
      >
        <input
          id={fid}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-error` : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-brand-700"
          {...rest}
        />
        <span>{label}</span>
      </label>
      {error && (
        <p id={`${fid}-error`} className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Form-level error banner (aria-live). */
export function FormError({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <div role="alert" className={cx('rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800', className)}>
      {children}
    </div>
  );
}
