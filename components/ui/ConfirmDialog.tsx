'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button';

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

/** Modal confirmation built on native <dialog> (focus trap, Esc to close, inert background). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Go back',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !loading) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl"
    >
      <div className="p-5 sm:p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <div id={descId} className="mt-2 text-sm leading-relaxed text-slate-600">
            {description}
          </div>
        )}
        {children}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
