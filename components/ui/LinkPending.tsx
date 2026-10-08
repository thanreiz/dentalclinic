'use client';

import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';
import { Spinner } from './icons';

/**
 * Loading feedback for staff navigation (QA-1). Place inside a next/link <Link>: while that link's
 * navigation is pending, the icon is swapped for a spinner (after 150 ms, so fast loads don't flicker).
 *
 * This replaces app/(staff)/loading.tsx on purpose: a loading.tsx (or any <Suspense>) around a staff
 * page made same-page navigations (?month=, ?date=) intermittently hang in Next 15.5 and turned
 * notFound() into a 200 soft 404. useLinkStatus adds no Suspense boundary.
 */
export function LinkPendingIcon({ children, className = 'size-5' }: { children: ReactNode; className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return <>{children}</>;
  return (
    <span className="grid shrink-0 place-items-center *:col-start-1 *:row-start-1" aria-hidden="true">
      <span className="link-pending-out">{children}</span>
      <span className="link-pending-in">
        <Spinner className={className} />
      </span>
    </span>
  );
}
