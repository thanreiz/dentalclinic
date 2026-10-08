'use client';

import { useEffect, useState } from 'react';
import type { Slot } from '@/lib/types';
import { api } from '@/components/api';

export type FreeChair = { chairId: number; chairName: string };
type LoadState = 'idle' | 'loading' | 'error';

/** Accepts the documented `{ chairs: [{chairId, chairName}] }` and tolerates snake_case rows. */
export function normalizeChairs(data: unknown): FreeChair[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(d.chairs) ? d.chairs : Array.isArray(d.freeChairs) ? d.freeChairs : Array.isArray(data) ? data : []) as Record<
    string,
    unknown
  >[];
  return arr
    .map((c) => ({
      chairId: Number(c.chairId ?? c.chair_id ?? c.id),
      chairName: String(c.chairName ?? c.chair_name ?? c.name ?? ''),
    }))
    .filter((c) => Number.isInteger(c.chairId) && c.chairId > 0);
}

/** GET /api/slots for the given choice; null params = nothing to load. */
export function useOpenSlots(params: { date: string; serviceId: number; dentistId: number | 'any'; excludeAppointmentId?: number } | null) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = params ? JSON.stringify(params) : null;

  useEffect(() => {
    if (!key) {
      setSlots(null);
      setState('idle');
      return;
    }
    const p = JSON.parse(key) as NonNullable<typeof params>;
    const qs = new URLSearchParams({ date: p.date, serviceId: String(p.serviceId), dentistId: String(p.dentistId) });
    if (p.excludeAppointmentId) qs.set('excludeAppointmentId', String(p.excludeAppointmentId));
    const ctrl = new AbortController();
    setState('loading');
    setMessage(null);
    api<{ slots: Slot[] }>(`/api/slots?${qs}`, { signal: ctrl.signal })
      .then((r) => {
        if (r.ok && Array.isArray(r.data.slots)) {
          setSlots(r.data.slots);
          setState('idle');
        } else {
          setSlots(null);
          setMessage(r.data.message ?? null);
          setState('error');
        }
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [key, nonce]);

  return { slots, state, message, reload: () => setNonce((n) => n + 1), setSlots };
}

/** GET /api/chairs/free?date&start&end&excludeId (Rule 6). */
export function useFreeChairs(params: { date: string; start: string; end: string; excludeId?: number } | null) {
  const [chairs, setChairs] = useState<FreeChair[] | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [nonce, setNonce] = useState(0);
  const key = params ? JSON.stringify(params) : null;

  useEffect(() => {
    if (!key) {
      setChairs(null);
      setState('idle');
      return;
    }
    const p = JSON.parse(key) as NonNullable<typeof params>;
    const qs = new URLSearchParams({ date: p.date, start: p.start, end: p.end });
    if (p.excludeId) qs.set('excludeId', String(p.excludeId));
    const ctrl = new AbortController();
    setState('loading');
    api(`/api/chairs/free?${qs}`, { signal: ctrl.signal })
      .then((r) => {
        if (r.ok) {
          setChairs(normalizeChairs(r.data));
          setState('idle');
        } else {
          setChairs(null);
          setState('error');
        }
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [key, nonce]);

  return { chairs, state, reload: () => setNonce((n) => n + 1), setChairs };
}
