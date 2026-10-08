import type { Metadata } from 'next';
import Link from 'next/link';
import { safeNextPath } from '@/lib/session';
import { ToothIcon } from '@/components/ui/icons';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Staff login' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  const clinicName = process.env.CLINIC_NAME || 'Sample Dental Clinic';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-brand-700 text-white shadow-sm">
            <ToothIcon className="size-7" />
          </span>
          <p className="mt-3 text-sm font-medium text-slate-600">{clinicName}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Staff login</h1>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm nextPath={nextPath} />
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          Patient?{' '}
          <Link className="font-semibold text-brand-800 underline underline-offset-2" href="/book">
            Book an appointment
          </Link>
        </p>
      </div>
    </main>
  );
}
