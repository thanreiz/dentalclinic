import { requireStaffPage } from '@/lib/auth';
import { countPendingCached } from '@/lib/queries/requests';
import { ToastProvider } from '@/components/ui/Toast';
import StaffShell from './StaffShell';

/** Every page under (staff) requires a session (defense in depth behind middleware.ts). */
export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // Independent queries: run together so the shell waits for the slower one, not the sum.
  const [user, pendingCount] = await Promise.all([requireStaffPage(), countPendingCached()]);
  const clinicName = process.env.CLINIC_NAME || 'Molar & Co.';
  return (
    <ToastProvider>
      <StaffShell clinicName={clinicName} userName={user.name || user.email} pendingCount={pendingCount}>
        {children}
      </StaffShell>
    </ToastProvider>
  );
}
