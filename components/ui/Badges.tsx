import type { AppointmentStatus, Channel } from '@/lib/rules';
import { cx } from './cx';
import { ChatIcon, GlobeIcon, PhoneIcon, WalkIcon } from './icons';

/** One distinct color per status (text colors meet AA on their tinted backgrounds). */
export const STATUS_STYLES: Record<AppointmentStatus, { badge: string; dot: string; block: string; label: string }> = {
  pending: {
    label: 'Pending',
    badge: 'bg-amber-100 text-amber-900 ring-amber-300',
    dot: 'bg-amber-500',
    block: 'bg-amber-50 border-amber-400 text-amber-950 hover:bg-amber-100',
  },
  scheduled: {
    label: 'Scheduled',
    badge: 'bg-blue-100 text-blue-800 ring-blue-300',
    dot: 'bg-blue-600',
    block: 'bg-blue-50 border-blue-500 text-blue-950 hover:bg-blue-100',
  },
  attended: {
    label: 'Attended',
    badge: 'bg-green-100 text-green-800 ring-green-300',
    dot: 'bg-green-600',
    block: 'bg-green-50 border-green-600 text-green-950 hover:bg-green-100',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'bg-slate-100 text-slate-700 ring-slate-300',
    dot: 'bg-slate-400',
    block: 'bg-slate-50 border-slate-400 text-slate-700 hover:bg-slate-100',
  },
  declined: {
    label: 'Declined',
    badge: 'bg-rose-50 text-rose-800 ring-rose-300',
    dot: 'bg-rose-400',
    block: 'bg-rose-50 border-rose-300 text-rose-900 hover:bg-rose-100',
  },
  'no-show': {
    label: 'No-show',
    badge: 'bg-red-700 text-white ring-red-800',
    dot: 'bg-white',
    block: 'bg-red-50 border-red-600 text-red-950 hover:bg-red-100',
  },
};

export function StatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap',
        s.badge,
        className,
      )}
    >
      <span className={cx('size-1.5 rounded-full', s.dot)} aria-hidden="true" />
      {s.label}
    </span>
  );
}

const CHANNEL_LABEL: Record<Channel, string> = { online: 'Online', phone: 'Phone', chat: 'Chat', 'walk-in': 'Walk-in' };
const CHANNEL_ICON = { online: GlobeIcon, phone: PhoneIcon, chat: ChatIcon, 'walk-in': WalkIcon } as const;

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap',
        className,
      )}
    >
      <Icon className="size-3.5" />
      {CHANNEL_LABEL[channel]}
    </span>
  );
}
