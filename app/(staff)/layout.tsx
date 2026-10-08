import { requireStaffPage } from '@/lib/auth';
import { countPending } from '@/lib/queries/requests';
import { ToastProvider } from '@/components/ui/Toast';
import StaffShell from './StaffShell';

/** Every page under (staff) requires a session (defense in depth behind middleware.ts). */
export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage();
  const pendingCount = await countPending();
  const clinicName = process.env.CLINIC_NAME || 'Sample Dental Clinic';
  return (
    <ToastProvider>
      <StaffShell clinicName={clinicName} userName={user.name || user.email} pendingCount={pendingCount}>
        {children}
      </StaffShell>
    </ToastProvider>
  );
}
