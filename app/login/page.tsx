import type { Metadata } from 'next';
import Link from 'next/link';
import { safeNextPath } from '@/lib/session';
import { BrandLockup } from '@/components/ui/BrandLogo';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Staff login' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandLockup className="h-14" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">Staff login</h1>
        </div>
        <div className="rounded-xl border border-rule bg-white p-6">
          <LoginForm nextPath={nextPath} />
        </div>
        <p className="mt-6 text-center text-sm text-ink-muted">
          Patient?{' '}
          <Link className="font-semibold text-brand-800 underline underline-offset-2" href="/book">
            Book an appointment
          </Link>
        </p>
      </div>
    </main>
  );
}
