import type { Metadata } from 'next';
import { requireStaffPage } from '@/lib/auth';
import { listChairs, listDentistsWithSchedules, listServices } from '@/lib/queries/setup';
import { PageHeader } from '@/components/ui/Card';
import SetupTabs, { type SetupTab } from './SetupTabs';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Setup' };

/** Clinic setup (FR5): dentists with weekly hours, services with durations, chairs. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('/setup');
  const sp = await searchParams;
  const tab: SetupTab = sp.tab === 'services' || sp.tab === 'chairs' ? sp.tab : 'dentists';
  const [dentists, services, chairs] = await Promise.all([listDentistsWithSchedules(), listServices(), listChairs()]);
  return (
    <>
      <PageHeader title="Clinic setup" description="Changes apply right away to open times on the booking form and the dashboard." />
      <SetupTabs initialTab={tab} dentists={dentists} services={services} chairs={chairs} />
    </>
  );
}
