'use client';

interface CountBadgeProps {
  count: number;
  /** attention = red (unread, overdue: tab-bars.md "Reserve badges for critical information"); neutral otherwise. */
  tone?: 'attention' | 'neutral';
  /** Counts above this read "{max}+". */
  max?: number;
  /** Show the badge at zero (neutral tone only). Attention badges hide at zero. */
  showZero?: boolean;
  className?: string;
}

/**
 * A numeric count chip (foundation-spec.md §12). It is aria-hidden: put the count in the owning control's
 * accessible name too, e.g. "Notificaciones (3 sin leer)".
 */
export function CountBadge({ count, tone = 'attention', max = 99, showZero = false, className = '' }: CountBadgeProps) {
  if (count <= 0 && (tone === 'attention' || !showZero)) return null;
  const colour = tone === 'attention' ? 'bg-brand-red text-white' : 'bg-surface text-secondary';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-caption font-semibold tabular-nums ${colour} ${className}`}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
