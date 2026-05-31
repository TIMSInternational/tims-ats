'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';

type FilterTab = 'all' | 'unread' | 'critical' | 'warning' | 'info' | 'success';

const FILTER_TABS: { key: FilterTab; label: string; color?: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'Sin Leer' },
  { key: 'critical', label: 'Critico', color: '#DD0C15' },
  { key: 'warning', label: 'Warning', color: '#F59E0B' },
  { key: 'info', label: 'Info', color: '#3B82F6' },
  { key: 'success', label: 'Success', color: '#22C55E' },
];

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

function timeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Hace ${days}d`;
  const months = Math.floor(days / 30);
  return `Hace ${months}m`;
}

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const utils = trpc.useUtils();

  const unreadOnly = activeTab === 'unread';
  const typeFilter = ['critical', 'warning', 'info', 'success'].includes(activeTab) ? activeTab : undefined;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    trpc.notification.list.useInfiniteQuery(
      { limit: 20, unreadOnly },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const allNotifications = data?.pages.flatMap((p) => p.notifications) ?? [];
  const filtered = typeFilter
    ? allNotifications.filter((n) => n.type === typeFilter)
    : allNotifications;

  const markAsReadMutation = trpc.notification.markAsRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const markAllAsReadMutation = trpc.notification.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const archiveAllReadMutation = trpc.notification.archiveAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const { data: unreadData } = trpc.notification.unreadCount.useQuery();
  const unreadCount = unreadData?.count ?? 0;

  return (
    <div className="p-6 max-w-[960px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#1F114C]">Notificaciones</h1>
          <p className="text-[13px] text-[#8B8B8B] mt-0.5">
            {unreadCount > 0
              ? `${unreadCount} notificacion${unreadCount !== 1 ? 'es' : ''} sin leer`
              : 'Todas las notificaciones al dia'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
              className="h-9 px-4 rounded-lg border border-[#EDEDED] text-[12px] font-medium text-[#585858] hover:bg-[#FAFAFA] transition-colors disabled:opacity-50"
            >
              Marcar todas como leidas
            </button>
          )}
          <button
            onClick={() => archiveAllReadMutation.mutate()}
            disabled={archiveAllReadMutation.isPending}
            className="h-9 px-4 rounded-lg border border-[#EDEDED] text-[12px] font-medium text-[#585858] hover:bg-[#FAFAFA] transition-colors disabled:opacity-50"
          >
            Archivar leidas
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-5 bg-[#FAFAFA] rounded-lg p-1 border border-[#EDEDED]">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[12px] font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-white text-[#1F114C] shadow-sm'
                : 'text-[#8B8B8B] hover:text-[#585858]'
            }`}
          >
            {tab.color && (
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: tab.color }}
              />
            )}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-xl border border-[#EDEDED] shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-[#1F114C]/20 border-t-[#1F114C] rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[13px] text-[#8B8B8B]">Cargando notificaciones...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <svg
              className="w-12 h-12 text-[#EDEDED] mx-auto mb-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              viewBox="0 0 24 24"
            >
              <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            <p className="text-[14px] font-medium text-[#585858]">
              {activeTab === 'all'
                ? 'No hay notificaciones'
                : activeTab === 'unread'
                ? 'No hay notificaciones sin leer'
                : `No hay notificaciones de tipo ${activeTab}`}
            </p>
            <p className="text-[12px] text-[#8B8B8B] mt-1">
              Cuando algo importante pase, aparecera aqui
            </p>
          </div>
        ) : (
          <>
            {filtered.map((notif) => (
              <button
                key={notif.id}
                onClick={() => {
                  if (!notif.read) {
                    markAsReadMutation.mutate({ id: notif.id });
                  }
                }}
                className={`w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-[#FAFAFA] transition-colors border-b border-[#F6F6F6] last:border-0 ${
                  !notif.read ? 'bg-blue-50/20' : ''
                }`}
              >
                {/* Type Dot */}
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${typeColor(notif.type)}`} />

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className={`text-[13px] text-[#333] leading-snug ${
                        !notif.read ? 'font-semibold' : ''
                      }`}
                    >
                      {notif.title}
                    </p>
                    <span className="text-[11px] text-[#8B8B8B] whitespace-nowrap shrink-0">
                      {timeAgo(notif.createdAt)}
                    </span>
                  </div>
                  {notif.message && (
                    <p className="text-[12px] text-[#8B8B8B] mt-1 line-clamp-2">{notif.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {notif.module && (
                      <span className="text-[10px] font-medium text-[#8B8B8B] bg-[#F6F6F6] rounded px-2 py-0.5 uppercase tracking-wide">
                        {notif.module}
                      </span>
                    )}
                    <span className={`text-[10px] font-medium rounded px-2 py-0.5 capitalize ${typeBadgeColor(notif.type)}`}>
                      {notif.type}
                    </span>
                  </div>
                </div>

                {/* Unread Indicator */}
                {!notif.read && (
                  <div className="w-2.5 h-2.5 rounded-full bg-[#1F114C] mt-1.5 shrink-0" />
                )}
              </button>
            ))}

            {/* Load More */}
            {hasNextPage && (
              <div className="px-5 py-4 border-t border-[#EDEDED] bg-[#FAFAFA] text-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="h-9 px-6 rounded-lg bg-[#1F114C] text-white text-[12px] font-medium hover:bg-[#1F114C]/90 transition-colors disabled:opacity-50"
                >
                  {isFetchingNextPage ? 'Cargando...' : 'Cargar mas'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
