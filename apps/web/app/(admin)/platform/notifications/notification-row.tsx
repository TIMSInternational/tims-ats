'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../../lib/format-utils';
import { IconButton, StatusBadge, type StatusTone } from '../../../../components';

const TYPE_TONE: Record<string, StatusTone> = {
  critical: 'danger',
  warning: 'warning',
  success: 'success',
  info: 'info',
};

interface NotificationRowProps {
  notification: {
    id: string;
    title: string;
    message: string | null;
    type: string;
    module: string | null;
    read: boolean;
    createdAt: string | Date;
  };
  onMarkRead: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

/** One notification. Clicking the text marks it read; archive and delete are named icon buttons, apart. */
export function NotificationRow({ notification: n, onMarkRead, onArchive, onDelete }: NotificationRowProps) {
  const { t, locale } = useI18n();
  const nt = t.notifications;
  const types = nt.types as Record<string, string>;

  return (
    <li className={`flex items-start gap-3 px-5 py-4 hover:bg-surface-hover ${n.read ? '' : 'bg-brand-tint/40'}`}>
      <button
        type="button"
        onClick={() => {
          if (!n.read) onMarkRead(n.id);
        }}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-start justify-between gap-3">
          <span className={`text-body leading-snug text-primary ${n.read ? '' : 'font-semibold'}`}>
            {!n.read && <span className="sr-only">{nt.unreadLabel}: </span>}
            {n.title}
          </span>
          <span className="shrink-0 whitespace-nowrap text-callout text-secondary">
            {formatRelativeTimeLocale(n.createdAt, locale)}
          </span>
        </span>
        {n.message && <span className="mt-1 line-clamp-2 block text-callout text-secondary">{n.message}</span>}
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge tone={TYPE_TONE[n.type] ?? 'info'}>{types[n.type] ?? n.type}</StatusBadge>
          {n.module && (
            <StatusBadge tone="neutral" icon="none">
              {n.module}
            </StatusBadge>
          )}
        </span>
      </button>
      <div className="mt-0.5 flex shrink-0 items-center gap-2">
        {!n.read && <span aria-hidden="true" className="size-2.5 rounded-full bg-brand" />}
        <IconButton label={nt.archive} onClick={() => onArchive(n.id)}>
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </IconButton>
        <IconButton label={nt.delete} variant="destructive" onClick={() => onDelete(n.id)}>
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </IconButton>
      </div>
    </li>
  );
}
