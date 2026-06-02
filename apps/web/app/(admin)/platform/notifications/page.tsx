'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatRelativeTime } from '../../../../lib/format-utils';

type FilterTab = 'all' | 'unread' | 'critical' | 'warning' | 'info' | 'success';

function typeColor(type: string) {
  switch (type) {
    case 'critical': return 'bg-[#DD0C15]';
    case 'warning': return 'bg-amber-500';
    case 'success': return 'bg-green-500';
    default: return 'bg-blue-500';
  }
}

function typeBadgeColor(type: string) {
  switch (type) {
    case 'critical': return 'text-[#DD0C15] bg-red-50';
    case 'warning': return 'text-amber-600 bg-amber-50';
    case 'success': return 'text-green-600 bg-green-50';
    default: return 'text-blue-600 bg-blue-50';
  }
}

export default function NotificationsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const utils = trpc.useUtils();

  const FILTER_TABS: { key: FilterTab; label: string; color?: string }[] = [
    { key: 'all', label: t.notifications.filterAll },
    { key: 'unread', label: t.notifications.filterUnread },
    { key: 'critical', label: t.notifications.filterCritical, color: '#DD0C15' },
    { key: 'warning', label: t.notifications.filterWarning, color: '#F59E0B' },
    { key: 'info', label: t.notifications.filterInfo, color: '#3B82F6' },
    { key: 'success', label: t.notifications.filterSuccess, color: '#22C55E' },
  ];

  const unreadOnly = activeTab === 'unread';
  const typeFilter = ['critical', 'warning', 'info', 'success'].includes(activeTab) ? activeTab : undefined;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    trpc.notification.list.useInfiniteQuery(
      { limit: 20, unreadOnly },
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    );

  const allNotifications = data?.pages.flatMap((p) => p.notifications) ?? [];
  const filtered = typeFilter ? allNotifications.filter((n) => n.type === typeFilter) : allNotifications;

  const invalidateAll = () => {
    utils.notification.list.invalidate();
    utils.notification.unreadCount.invalidate();
  };

  const markAsRead = trpc.notification.markAsRead.useMutation({ onSuccess: invalidateAll });
  const markAllAsRead = trpc.notification.markAllAsRead.useMutation({ onSuccess: invalidateAll });
  const archiveAllRead = trpc.notification.archiveAllRead.useMutation({ onSuccess: invalidateAll });
  const archiveSingle = trpc.notification.archive.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.notifications.archive, { type: 'success' }); },
  });
  const deleteSingle = trpc.notification.delete.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.notifications.delete, { type: 'success' }); },
  });

  const { data: unreadData } = trpc.notification.unreadCount.useQuery();
  const unreadCount = unreadData?.count ?? 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-[960px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#1F114C]">{t.notifications.title}</h1>
            <p className="text-[13px] text-[#8B8B8B] mt-0.5">
              {unreadCount > 0 ? `${unreadCount} ${t.notifications.unreadCount}` : t.notifications.allCaughtUp}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={() => markAllAsRead.mutate()} disabled={markAllAsRead.isPending} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-[12px] font-medium text-[#585858] hover:bg-[#FAFAFA] transition disabled:opacity-50">
                {t.notifications.markAllRead}
              </button>
            )}
            <button onClick={() => archiveAllRead.mutate()} disabled={archiveAllRead.isPending} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-[12px] font-medium text-[#585858] hover:bg-[#FAFAFA] transition disabled:opacity-50">
              {t.notifications.archiveRead}
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 mb-5 bg-[#FAFAFA] rounded-lg p-1 border border-[#EDEDED]">
          {FILTER_TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[12px] font-medium transition-all ${activeTab === tab.key ? 'bg-white text-[#1F114C] shadow-sm' : 'text-[#8B8B8B] hover:text-[#585858]'}`}>
              {tab.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tab.color }} />}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="bg-white rounded-xl border border-[#EDEDED] shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {isLoading ? (
            <div className="py-16 text-center">
              <div className="w-6 h-6 border-2 border-[#1F114C]/20 border-t-[#1F114C] rounded-full animate-spin mx-auto mb-3" />
              <p className="text-[13px] text-[#8B8B8B]">{t.notifications.loading}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              <p className="text-[14px] font-medium text-[#585858]">
                {activeTab === 'all' ? t.notifications.noNotifications : activeTab === 'unread' ? t.notifications.noUnread : `${t.notifications.noType} ${activeTab}`}
              </p>
              <p className="text-[12px] text-[#8B8B8B] mt-1">{t.notifications.emptyDesc}</p>
            </div>
          ) : (
            <>
              {filtered.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-4 px-5 py-4 hover:bg-[#FAFAFA] transition-colors border-b border-[#F6F6F6] last:border-0 ${!notif.read ? 'bg-blue-50/20' : ''}`}
                >
                  {/* Type Dot */}
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${typeColor(notif.type)}`} />

                  {/* Content — clickable to mark as read */}
                  <button
                    onClick={() => { if (!notif.read) markAsRead.mutate({ id: notif.id }); }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className={`text-[13px] text-[#333] leading-snug ${!notif.read ? 'font-semibold' : ''}`}>{notif.title}</p>
                      <span className="text-[11px] text-[#8B8B8B] whitespace-nowrap shrink-0">{formatRelativeTime(notif.createdAt)}</span>
                    </div>
                    {notif.message && <p className="text-[12px] text-[#8B8B8B] mt-1 line-clamp-2">{notif.message}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      {notif.module && <span className="text-[10px] font-medium text-[#8B8B8B] bg-[#F6F6F6] rounded px-2 py-0.5 uppercase tracking-wide">{notif.module}</span>}
                      <span className={`text-[10px] font-medium rounded px-2 py-0.5 capitalize ${typeBadgeColor(notif.type)}`}>{notif.type}</span>
                    </div>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 mt-1">
                    {!notif.read && <div className="w-2.5 h-2.5 rounded-full bg-[#1F114C]" title="Unread" />}
                    <button
                      onClick={() => archiveSingle.mutate({ id: notif.id })}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] hover:text-[#585858] transition"
                      title={t.notifications.archive}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                    </button>
                    <button
                      onClick={() => deleteSingle.mutate({ id: notif.id })}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-[#8B8B8B] hover:bg-red-50 hover:text-[#DD0C15] transition"
                      title={t.notifications.delete}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    </button>
                  </div>
                </div>
              ))}

              {/* Load More */}
              {hasNextPage && (
                <div className="px-5 py-4 border-t border-[#EDEDED] bg-[#FAFAFA] text-center">
                  <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="h-9 px-6 rounded-lg bg-[#1F114C] text-white text-[12px] font-medium hover:bg-[#2a1866] transition disabled:opacity-50">
                    {isFetchingNextPage ? t.notifications.loadingMore : t.notifications.loadMore}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
