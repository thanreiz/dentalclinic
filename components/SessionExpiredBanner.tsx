'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SESSION_EXPIRED_EVENT } from '@/components/api';
import { AlertIcon } from '@/components/ui/icons';

/** Shown when an action fails because the session ended: says so and links to the login page, which returns here. */
export default function SessionExpiredBanner() {
  const [expired, setExpired] = useState(false);
  const pathname = usePathname() ?? '/dashboard';
  const search = useSearchParams()?.toString();
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const on = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, on);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, on);
  }, []);
  useEffect(() => {
    if (expired) linkRef.current?.focus();
  }, [expired]);

  if (!expired) return null;
  const next = encodeURIComponent(search ? `${pathname}?${search}` : pathname);
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <AlertIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 font-medium">Your session has ended. Nothing was saved from your last action.</span>
      <Link ref={linkRef} href={`/login?next=${next}`} className="inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800">
        Log in again
      </Link>
    </div>
  );
}
