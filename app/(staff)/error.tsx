'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { AlertIcon } from '@/components/ui/icons';

export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center" role="alert">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-red-50 text-red-700">
        <AlertIcon className="size-6" />
      </div>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">This page could not be loaded</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
        Something went wrong while reading the clinic data. Try again; if it keeps happening, check that the database is running.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Ref: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/dashboard">Go to dashboard</ButtonLink>
      </div>
    </div>
  );
}
