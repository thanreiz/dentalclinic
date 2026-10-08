import { requireStaffPage } from '@/lib/auth';

/** Every page under (staff) requires a session (defense in depth behind middleware.ts). */
export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireStaffPage();
  return <>{children}</>;
}
