'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/components/api';
import { Button } from '@/components/ui/Button';
import { FormError, Input } from '@/components/ui/Field';

/** Email + password. Errors stay generic (never say which field was wrong). */
export default function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const fe: typeof fieldErr = {};
    if (!email) fe.email = 'Enter your email';
    if (!password) fe.password = 'Enter your password';
    setFieldErr(fe);
    if (fe.email || fe.password) return;

    setPending(true);
    const r = await api('/api/auth/login', { body: { email, password } });
    if (r.ok) {
      router.replace(nextPath);
      router.refresh();
      return;
    }
    setPending(false);
    if (r.status === 0) setError('Could not reach the server. Try again.');
    else if (r.status === 429) setError('Too many attempts. Please wait a few minutes and try again.');
    else setError('Invalid email or password');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Input label="Email" name="email" type="email" autoComplete="username" required autoFocus error={fieldErr.email} />
      <Input label="Password" name="password" type="password" autoComplete="current-password" required error={fieldErr.password} />
      <FormError>{error}</FormError>
      <Button type="submit" size="lg" className="mt-1 w-full" loading={pending} loadingText="Signing in…">
        Sign in
      </Button>
    </form>
  );
}
