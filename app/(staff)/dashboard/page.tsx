import { requireStaffPage } from '@/lib/auth';
import LogoutButton from '@/app/(staff)/LogoutButton';

export const dynamic = 'force-dynamic';

/** Placeholder: the Frontend agent builds the real schedule dashboard (PRD Phase 6). */
export default async function DashboardPage() {
  const user = await requireStaffPage('/dashboard');
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <LogoutButton />
      </div>
      <p className="mt-4 text-gray-600">Signed in as {user.name || user.email}.</p>
    </main>
  );
}
