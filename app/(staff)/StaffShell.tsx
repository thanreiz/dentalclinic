'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { CalendarIcon, ChartIcon, CogIcon, InboxIcon, MenuIcon, PlusIcon, UsersIcon, XIcon } from '@/components/ui/icons';
import { BrandIcon, BrandLockup } from '@/components/ui/BrandLogo';
import { LinkPendingIcon } from '@/components/ui/LinkPending';
import LogoutButton from './LogoutButton';

type NavItem = { href: string; label: string; icon: (p: { className?: string }) => ReactNode; badge?: boolean };

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Front desk',
    items: [
      { href: '/dashboard', label: 'Schedule', icon: CalendarIcon },
      { href: '/requests', label: 'Requests', icon: InboxIcon, badge: true },
      { href: '/appointments/new', label: 'New booking', icon: PlusIcon },
    ],
  },
  {
    label: 'Clinic',
    items: [
      { href: '/patients', label: 'Patients', icon: UsersIcon },
      { href: '/reports', label: 'Reports', icon: ChartIcon },
      { href: '/setup', label: 'Setup', icon: CogIcon },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/appointments/new') return pathname === href;
  if (href === '/requests') return pathname.startsWith('/requests');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase() || 'S';
}

/**
 * Staff app shell, "open plane": the sidebar sits straight on the page ground (no top bar) from 1024 px.
 * Below that, a 48 px bar holds the clinic mark, the current page and a menu button that opens a
 * full-screen sheet with the same navigation.
 */
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
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const all = GROUPS.flatMap((g) => g.items);
  const current = all.find((i) => isActive(pathname, i.href))?.label ?? clinicName;

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

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {GROUPS.map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-3 text-xs font-medium text-slate-500">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm lg:h-9',
                      active ? 'bg-brand-100 font-semibold text-brand-900' : 'font-medium text-slate-700 hover:bg-brand-50 hover:text-slate-900',
                    )}
                  >
                    <LinkPendingIcon className="size-4">
                      <Icon className={cx('size-[18px] lg:size-4', active ? 'text-brand-700' : 'text-slate-500')} />
                    </LinkPendingIcon>
                    {item.label}
                    {item.badge && badge(active)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const user = (
    <div className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-900" aria-hidden="true">
        {initials(userName)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
        <p className="text-xs text-slate-500">Front desk</p>
      </div>
    </div>
  );

  const mark = (
    <Link href="/dashboard" aria-label={`${clinicName}, schedule`} className="block rounded-md">
      <BrandLockup className="h-10" />
    </Link>
  );

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop: sidebar on the ground */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-[var(--color-rule)] px-3 py-5 lg:flex">
        <div className="flex flex-col gap-8">
          <div className="px-1">{mark}</div>
          {nav}
        </div>
        <div className="flex flex-col gap-3 border-t border-[var(--color-rule)] px-1 pt-4">
          {user}
          <LogoutButton />
        </div>
      </aside>

      {/* Below 1024 px: 48 px bar + menu sheet */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-[var(--color-rule)] bg-canvas px-4 lg:hidden">
        <BrandIcon className="h-8 shrink-0" />
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-900">{current}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={pendingCount > 0 ? `Open menu, ${pendingCount} pending requests` : 'Open menu'}
          aria-expanded={open}
          className="relative -mr-2 grid size-11 place-items-center rounded-lg text-slate-700 hover:bg-brand-50"
        >
          <MenuIcon className="size-5" />
          {pendingCount > 0 && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-amber-500" aria-hidden="true" />}
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-canvas lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-rule)] px-4">
            {mark}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="-mr-2 grid size-11 place-items-center rounded-lg text-slate-700 hover:bg-brand-50"
            >
              <XIcon className="size-5" />
            </button>
          </div>
          <div className="flex flex-1 flex-col justify-between gap-8 px-4 py-6">
            {nav}
            <div className="flex flex-col gap-3 border-t border-[var(--color-rule)] pt-4">
              {user}
              <LogoutButton />
            </div>
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
