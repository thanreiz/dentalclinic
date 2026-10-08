'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { AlertIcon, CheckIcon, InfoIcon, XIcon } from './icons';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';
type Toast = { id: number; tone: ToastTone; title: string; description?: string };
type ToastApi = { show: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Toasts survive client navigation (provider lives in a layout), so "save, then redirect, then toast" works. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONES: Record<ToastTone, { box: string; icon: typeof CheckIcon; iconCls: string }> = {
  success: { box: 'border-green-200', icon: CheckIcon, iconCls: 'bg-green-100 text-green-800' },
  error: { box: 'border-red-200', icon: AlertIcon, iconCls: 'bg-red-100 text-red-800' },
  warning: { box: 'border-amber-300', icon: AlertIcon, iconCls: 'bg-amber-100 text-amber-900' },
  info: { box: 'border-slate-200', icon: InfoIcon, iconCls: 'bg-slate-100 text-slate-700' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TONES[toast.tone];
  const Icon = tone.icon;
  useEffect(() => {
    const ms = toast.tone === 'error' || toast.tone === 'warning' ? 9000 : 5000;
    const h = setTimeout(onDismiss, ms);
    return () => clearTimeout(h);
  }, [toast.tone, onDismiss]);
  return (
    <div
      role={toast.tone === 'error' || toast.tone === 'warning' ? 'alert' : 'status'}
      className={cx(
        'animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white p-3.5 shadow-lg',
        tone.box,
      )}
    >
      <span className={cx('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', tone.iconCls)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-slate-600">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="-m-1 grid size-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        aria-label="Dismiss notification"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
