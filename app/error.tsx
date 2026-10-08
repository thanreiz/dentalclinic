'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center px-4 py-16 text-center" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-600">Please try again in a moment.</p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
