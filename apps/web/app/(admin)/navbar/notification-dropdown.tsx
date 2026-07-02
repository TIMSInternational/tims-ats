'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

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

export function NotificationDropdown({ onOpen }: { onOpen?: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const timeAgo = useTimeAgo();

  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  useClickOutside(notifRef, () => setNotifOpen(false));

  const { data: unreadData, isError: unreadError, refetch: refetchUnread } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: notifData, isError: notifError, refetch: refetchNotifs } = trpc.notification.list.useQuery(
    { limit: 10 },
    { enabled: notifOpen }
  );

  const markAsReadMutation = trpc.notification.markAsRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });

  const markAllAsReadMutation = trpc.notification.markAllAsRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notifData?.notifications ?? [];

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
        onClick={() => { setNotifOpen(!notifOpen); onOpen?.(); }}
        className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          notifOpen ? 'bg-[#F6F6F6]' : 'hover:bg-[#F6F6F6]'
        }`}
      >
        <svg className="w-[18px] h-[18px] text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-[#DD0C15] text-white text-[8px] font-bold flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {notifOpen && (
        <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] max-w-[380px] bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[#EDEDED] z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEDED]">
            <h3 className="text-[13px] font-semibold text-[#1F114C]">
              {t.nav.notifications}
              {unreadCount > 0 && (
                <span className="ml-1.5 text-[11px] font-normal text-[#8B8B8B]">({unreadCount} {t.nav.unread})</span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={markAllAsReadMutation.isPending}
                className="text-[11px] text-[#DD0C15] font-medium hover:underline disabled:opacity-50"
              >
                {t.nav.markAllRead}
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {unreadError || notifError ? (
              <ErrorState onRetry={() => { refetchUnread(); refetchNotifs(); }} />
            ) : notifications.length === 0 ? (
              <div className="py-12 text-center">
                <svg className="w-10 h-10 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                  <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <p className="text-[13px] text-[#8B8B8B]">{t.nav.noNotifications}</p>
                <p className="text-[11px] text-[#ccc] mt-1">{t.nav.noNotificationsDesc}</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#FAFAFA] transition-colors border-b border-[#F6F6F6] last:border-0 ${
                    !notif.read ? 'bg-blue-50/30' : ''
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    notif.type === 'critical' ? 'bg-[#DD0C15]' :
                    notif.type === 'warning' ? 'bg-amber-500' :
                    notif.type === 'success' ? 'bg-green-500' : 'bg-blue-500'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] text-[#333] leading-snug ${!notif.read ? 'font-medium' : ''}`}>
                      {notif.title}
                    </p>
                    {notif.message && (
                      <p className="text-[11px] text-[#8B8B8B] mt-0.5 line-clamp-1">{notif.message}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-[#8B8B8B]">{timeAgo(notif.createdAt)}</span>
                      {notif.module && (
                        <span className="text-[9px] text-[#8B8B8B] bg-[#F6F6F6] rounded px-1.5 py-0.5">{notif.module}</span>
                      )}
                    </div>
                  </div>
                  {!notif.read && (
                    <div className="w-2 h-2 rounded-full bg-[#1F114C] mt-1.5 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[#EDEDED] bg-[#FAFAFA]">
              <button
                onClick={() => { router.push('/platform/notifications'); setNotifOpen(false); }}
                className="text-[12px] text-[#1F114C] font-medium hover:underline w-full text-center"
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
