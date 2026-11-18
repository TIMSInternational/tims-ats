'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components/error-state';
import { Skeleton } from '../../../components/skeleton';
import { CountBadge } from '../../../components/count-badge';
import { useDismissable } from '../../../lib/use-dismissable';
import { notificationModuleLabel, notificationTypeLabel } from '../../../lib/notification-labels';

function useTimeAgo() {
  const { t } = useI18n();
  return (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t.nav.now;
    if (minutes < 60) return t.nav.minutesAgo.replace('{n}', String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t.nav.hoursAgo.replace('{n}', String(hours));
    const days = Math.floor(hours / 24);
    return t.nav.daysAgo.replace('{n}', String(days));
  };
}

export function NotificationDropdown({
  isPlatformOwner = false,
  onOpen,
}: {
  isPlatformOwner?: boolean;
  onOpen?: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const timeAgo = useTimeAgo();

  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  // Outside click and Escape close the panel; Escape returns focus to the bell.
  useDismissable(notifOpen, notifRef, () => setNotifOpen(false), bellRef);

  const {
    data: unreadData,
    isError: unreadError,
    error: unreadErr,
    refetch: refetchUnread,
  } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const {
    data: notifData,
    isLoading: notifLoading,
    isError: notifError,
    error: notifErr,
    refetch: refetchNotifs,
  } = trpc.notification.list.useQuery({ limit: 10 }, { enabled: notifOpen });

  const markAsReadMutation = trpc.notification.markAsRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });

  const markAllAsReadMutation = trpc.notification.markAllAsRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notifData?.notifications ?? [];
  const bellLabel = unreadCount > 0 ? `${t.nav.notifications} (${unreadCount} ${t.nav.unread})` : t.nav.notifications;

  const handleNotifClick = (notif: { id: string; read: boolean; actionUrl?: string | null }) => {
    if (!notif.read) markAsReadMutation.mutate({ id: notif.id });
    if (notif.actionUrl) {
      router.push(notif.actionUrl);
      setNotifOpen(false);
    }
  };

  return (
    <div ref={notifRef} className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => {
          setNotifOpen(!notifOpen);
          onOpen?.();
        }}
        aria-label={bellLabel}
        aria-expanded={notifOpen}
        className={`relative flex size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--chrome-text-secondary)] transition-colors hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-text-primary)] pointer-coarse:size-11 ${
          notifOpen ? 'bg-[var(--chrome-hover)]' : ''
        }`}
      >
        <svg className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden>
          <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        <CountBadge count={unreadCount} className="absolute -right-1 -top-1" />
      </button>

      {notifOpen && (
        <div className="tims-surface fixed inset-x-4 top-12 md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[380px] bg-white rounded-xl shadow-popover border border-border z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-body font-semibold text-brand">
              {t.nav.notifications}
              {unreadCount > 0 && (
                <span className="ml-1.5 text-callout font-normal text-secondary">
                  ({unreadCount} {t.nav.unread})
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={markAllAsReadMutation.isPending}
                className="text-callout text-brand font-medium underline-offset-2 hover:underline disabled:opacity-50 pointer-coarse:min-h-11"
              >
                {t.nav.markAllRead}
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto" aria-busy={notifLoading || undefined}>
            {unreadError || notifError ? (
              <ErrorState
                size="compact"
                error={notifErr ?? unreadErr}
                onRetry={() => {
                  refetchUnread();
                  refetchNotifs();
                }}
              />
            ) : notifLoading ? (
              <div className="divide-y divide-border-subtle">
                <span className="sr-only" role="status">
                  {t.common.loadingContent}
                </span>
                {[0, 1, 2].map((row) => (
                  <div key={row} className="space-y-2 px-4 py-3">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-12 text-center">
                <svg
                  className="w-8 h-8 text-muted mx-auto mb-3"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <p className="text-body font-medium text-primary">{t.nav.noNotifications}</p>
                <p className="mx-auto mt-1 max-w-xs text-callout text-secondary">{t.nav.noNotificationsDesc}</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const moduleLabel = notificationModuleLabel(t.nav.notificationModules, notif.module);
                const typeLabel = notificationTypeLabel(t.nav.notificationTypes, notif.type);
                return (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => handleNotifClick(notif)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors border-b border-border-subtle last:border-0 ${
                      !notif.read ? 'bg-brand-tint/40' : ''
                    }`}
                  >
                    <div
                      title={typeLabel}
                      aria-hidden
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        notif.type === 'critical'
                          ? 'bg-brand-red'
                          : notif.type === 'warning'
                            ? 'bg-warning'
                            : notif.type === 'success'
                              ? 'bg-success'
                              : 'bg-info'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="sr-only">{typeLabel}: </span>
                      <p className={`text-body text-primary leading-snug ${!notif.read ? 'font-medium' : ''}`}>
                        {notif.title}
                      </p>
                      {notif.message && (
                        <p className="text-callout text-secondary mt-0.5 line-clamp-2">{notif.message}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-caption text-muted">{timeAgo(notif.createdAt)}</span>
                        {moduleLabel && (
                          <span className="text-caption text-secondary bg-surface rounded px-1.5 py-0.5">
                            {moduleLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    {!notif.read && <div aria-hidden className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {/* The full list lives under /platform, whose layout redirects non-owners to /dashboard — so the
              footer link is only offered to platform owners (a tenant user would just bounce home). */}
          {isPlatformOwner && notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border bg-surface-hover">
              <button
                type="button"
                onClick={() => {
                  router.push('/platform/notifications');
                  setNotifOpen(false);
                }}
                className="text-callout text-brand font-medium underline-offset-2 hover:underline w-full text-center pointer-coarse:min-h-11"
              >
                {t.nav.viewAll}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
