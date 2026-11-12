import type { AppointmentStatus, Channel } from '@/lib/rules';
import { cx } from './cx';
import { ChatIcon, GlobeIcon, PhoneIcon, WalkIcon } from './icons';

/** One distinct color per status, from the Molar & Co. tokens (brand/tokens.md; text pairs are contrast-checked there). */
export const STATUS_STYLES: Record<AppointmentStatus, { badge: string; dot: string; block: string; label: string }> = {
  pending: {
    label: 'Pending',
    badge: 'bg-status-pending-bg text-status-pending-fg ring-status-pending-dot/40',
    dot: 'bg-status-pending-dot',
    block: 'bg-status-pending-bg/70 border-dashed border-status-pending-dot text-status-pending-fg hover:bg-status-pending-bg',
  },
  scheduled: {
    label: 'Scheduled',
    badge: 'bg-status-scheduled-bg text-status-scheduled-fg ring-status-scheduled-dot/40',
    dot: 'bg-status-scheduled-dot',
    block: 'bg-status-scheduled-bg/70 border-status-scheduled-dot text-status-scheduled-fg hover:bg-status-scheduled-bg',
  },
  attended: {
    label: 'Attended',
    badge: 'bg-status-attended-bg text-status-attended-fg ring-status-attended-dot/40',
    dot: 'bg-status-attended-dot',
    block: 'bg-status-attended-bg/70 border-status-attended-dot text-status-attended-fg hover:bg-status-attended-bg',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'bg-status-cancelled-bg text-status-cancelled-fg ring-status-cancelled-dot/40',
    dot: 'bg-status-cancelled-dot',
    block: 'bg-status-cancelled-bg/70 border-status-cancelled-dot text-status-cancelled-fg hover:bg-status-cancelled-bg',
  },
  // Brand rule: the terracotta accent is never a status color. Declined shares the neutral family
  // with cancelled and is told apart by a hollow dot, a dotted block border and its label.
  declined: {
    label: 'Declined',
    badge: 'bg-status-cancelled-bg text-status-cancelled-fg ring-status-cancelled-dot/40',
    dot: 'bg-transparent ring-1 ring-inset ring-status-cancelled-fg',
    block: 'bg-status-cancelled-bg/50 border-dotted border-status-cancelled-dot text-status-cancelled-fg hover:bg-status-cancelled-bg',
  },
  'no-show': {
    label: 'No-show',
    badge: 'bg-status-noshow-bg text-status-noshow-fg ring-status-noshow-dot/40',
    dot: 'bg-status-noshow-dot',
    block: 'bg-status-noshow-bg/70 border-status-noshow-dot text-status-noshow-fg hover:bg-status-noshow-bg',
  },
};

export function StatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap transition-colors duration-200',
        s.badge,
        className,
      )}
    >
      <span className={cx('size-1.5 rounded-full transition-colors duration-200', s.dot)} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export const CHANNEL_LABEL: Record<Channel, string> = { online: 'Online', phone: 'Phone', chat: 'Chat', 'walk-in': 'Walk-in' };
const CHANNEL_ICON = { online: GlobeIcon, phone: PhoneIcon, chat: ChatIcon, 'walk-in': WalkIcon } as const;

export function ChannelBadge({ channel, className, label }: { channel: Channel; className?: string; label?: string }) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-ink whitespace-nowrap',
        className,
      )}
    >
      <Icon className="size-3.5" />
      {label ?? CHANNEL_LABEL[channel]}
    </span>
  );
}
