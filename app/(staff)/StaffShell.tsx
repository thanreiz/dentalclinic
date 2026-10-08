'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { CalendarIcon, ChartIcon, CogIcon, InboxIcon, PlusIcon, ToothIcon, UsersIcon } from '@/components/ui/icons';
import LogoutButton from './LogoutButton';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: CalendarIcon },
  { href: '/requests', label: 'Requests', icon: InboxIcon, badge: true },
  { href: '/appointments/new', label: 'New booking', icon: PlusIcon },
  { href: '/patients', label: 'Patients', icon: UsersIcon },
  { href: '/reports', label: 'Reports', icon: ChartIcon },
  { href: '/setup', label: 'Setup', icon: CogIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/appointments/new') return pathname === href;
  if (href === '/requests') return pathname.startsWith('/requests');
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Staff app shell: top bar (clinic name, user, logout) + nav (sidebar at 1024 px+, tab row below). */
export default function StaffShell({
  clinicName,
  userName,
  pendingCount,
  children,
}: {
  clinicName: string;
  userName: string;
  pendingCount: number;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';

  const links = NAV.map((item) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return { ...item, active, Icon };
  });

  const badge = (active: boolean) =>
    pendingCount > 0 ? (
      <span
        className={cx(
          'ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
          active ? 'bg-brand-700 text-white' : 'bg-amber-100 text-amber-900',
        )}
        aria-label={`${pendingCount} pending`}
      >
        {pendingCount}
      </span>
    ) : null;

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-md">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-700 text-white">
              <ToothIcon className="size-5" />
            </span>
            <span className="truncate text-base font-semibold text-slate-900">{clinicName}</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{userName}</span>
            <LogoutButton />
          </div>
        </div>
        {/* Below 1024 px: horizontal tab row */}
        <nav aria-label="Main" className="overflow-x-auto border-t border-slate-100 lg:hidden">
          <ul className="flex min-w-max gap-1 px-2 md:px-4">
            {links.map(({ href, label, active, Icon, ...rest }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                    active ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-slate-900',
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                  {'badge' in rest && badge(false)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className="lg:flex">
        <nav aria-label="Main" className="hidden w-60 shrink-0 lg:block">
          <ul className="sticky top-14 flex flex-col gap-1 p-4">
            {links.map(({ href, label, active, Icon, ...rest }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium',
                    active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon className={cx('size-[18px]', active ? 'text-brand-700' : 'text-slate-500')} />
                  {label}
                  {'badge' in rest && badge(active)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-6 lg:py-8 lg:pr-8 lg:pl-2">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
