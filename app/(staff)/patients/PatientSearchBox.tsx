'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { SearchIcon, Spinner } from '@/components/ui/icons';
import { controlBase } from '@/components/ui/Field';
import { cx } from '@/components/ui/cx';

/** Debounced search that updates ?q= (server renders the results). Works as a plain GET form without JS. */
export default function PatientSearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h = setTimeout(() => {
      const qs = q.trim() ? `?${new URLSearchParams({ q: q.trim() })}` : '';
      startTransition(() => router.replace(`${pathname}${qs}`));
    }, 300);
    return () => clearTimeout(h);
  }, [q, pathname, router]);

  return (
    <form role="search" action={pathname} method="get" onSubmit={(e) => e.preventDefault()} className="relative">
      <label htmlFor="patient-q" className="sr-only">
        Search patients by name or contact number
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400" />
      <input
        id="patient-q"
        name="q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or contact number"
        autoComplete="off"
        className={cx(controlBase, 'h-11 border-slate-300 pr-10 pl-10')}
      />
      {isPending && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400" />}
    </form>
  );
}
