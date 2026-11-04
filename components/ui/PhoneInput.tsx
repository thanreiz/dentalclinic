'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { controlBase } from './Field';
import { cx } from './cx';

/** Live filter: digits only, drops a pasted +63 / 63 / 0 prefix, max 10 digits ("917 555 0101" -> "9175550101"). */
export function cleanMobileDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('63') && d.length > 10) d = d.slice(2);
  else if (d.startsWith('0')) d = d.replace(/^0+/, '');
  return d.slice(0, 10);
}

/** Stored form 09XXXXXXXXX -> the 10 digits shown after the fixed +63 ('' when it is not a PH mobile). */
export function toMobileDigits(stored: string): string {
  return /^09\d{9}$/.test(stored) ? stored.slice(1) : '';
}

type Props = {
  label: ReactNode;
  value: string;
  onValueChange: (digits: string) => void;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  wrapperClassName?: string;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'maxLength' | 'inputMode'>;

/**
 * PH mobile number input: a fixed "+63" prefix, digits only, exactly 10 digits (starts with 9).
 * The value held in state is the 10 digits; the server (normalizeMobile) turns it into 09XXXXXXXXX.
 */
export function PhoneInput({ label, value, onValueChange, error, hint, optional, wrapperClassName, className, id, required, onKeyDown, ...rest }: Props) {
  const autoId = useId();
  const fid = id ?? autoId;
  const help = hint ?? '10 digits, starts with 9';
  const described = error ? `${fid}-error` : `${fid}-hint`;
  return (
    <div className={cx('flex flex-col gap-1.5', wrapperClassName)}>
      <label htmlFor={fid} className="text-sm font-medium text-slate-800">
        {label}
        {required && (
          <span className="ml-0.5 text-red-700" aria-hidden="true">
            *
          </span>
        )}
        {optional && <span className="ml-1.5 font-normal text-slate-500">(optional)</span>}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 px-3 text-base text-slate-600 sm:text-sm">
          +63
        </span>
        <input
          id={fid}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="917 555 0101"
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className={cx(controlBase, error ? 'border-red-600' : 'border-slate-300', 'h-11 pl-16', className)}
          value={value}
          onChange={(e) => onValueChange(cleanMobileDigits(e.target.value))}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            // Block letters/symbols before they enter the field (paste/autofill still go through onChange).
            if (!e.defaultPrevented && e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
          }}
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${fid}-error`} className="flex items-start gap-1 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : (
        <p id={`${fid}-hint`} className="text-xs text-slate-500">
          {help}
        </p>
      )}
    </div>
  );
}
