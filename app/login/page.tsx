import type { Metadata } from 'next';
import Link from 'next/link';
import { safeNextPath } from '@/lib/session';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Staff login' };

/** Placeholder login screen (Frontend agent restyles). */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-semibold">Staff login</h1>
      <LoginForm nextPath={nextPath} />
      <p className="mt-6 text-sm text-gray-500">
        Patient? <Link className="underline" href="/book">Request an appointment</Link>
      </p>
    </main>
  );
}
