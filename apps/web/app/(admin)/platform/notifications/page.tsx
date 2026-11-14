'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { formatMessage, pluralize, useI18n } from '../../../../lib/i18n';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  TabPanel,
  Tabs,
} from '../../../../components';
import { NotificationRow } from './notification-row';

type FilterTab = 'all' | 'unread' | 'critical' | 'warning' | 'info' | 'success';
const TYPE_TABS: FilterTab[] = ['critical', 'warning', 'info', 'success'];
const ID_PREFIX = 'notifications';

export default function NotificationsPage() {
  const { t, locale } = useI18n();
  const nt = t.notifications;
  const types = nt.types as Record<string, string>;
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const tabs = [
    { id: 'all', label: nt.filterAll },
    { id: 'unread', label: nt.filterUnread },
    { id: 'critical', label: nt.filterCritical },
    { id: 'warning', label: nt.filterWarning },
    { id: 'info', label: nt.filterInfo },
    { id: 'success', label: nt.filterSuccess },
  ];

  const unreadOnly = activeTab === 'unread';
  const typeFilter = TYPE_TABS.includes(activeTab) ? activeTab : undefined;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error, refetch } =
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
  const onActionError = () => toast(nt.actionError, { type: 'error' });

  const markAsRead = trpc.notification.markAsRead.useMutation({ onSuccess: invalidateAll, onError: onActionError });
  const markAllAsRead = trpc.notification.markAllAsRead.useMutation({
    onSuccess: invalidateAll,
    onError: onActionError,
  });
  const archiveAllRead = trpc.notification.archiveAllRead.useMutation({
    onSuccess: invalidateAll,
    onError: onActionError,
  });
  const archiveSingle = trpc.notification.archive.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(nt.archived, { type: 'success' });
    },
    onError: onActionError,
  });
  const deleteSingle = trpc.notification.delete.useMutation({
    onSuccess: () => {
      invalidateAll();
      setDeleteId(null);
      toast(nt.deleted, { type: 'success' });
    },
    onError: onActionError,
  });

  const unreadQuery = trpc.notification.unreadCount.useQuery();
  const unreadCount = unreadQuery.data?.count ?? 0;

  // Nothing until the count arrives (never "all caught up" before we know); a failed count just hides the line.
  const subtitle =
    unreadQuery.isLoading || unreadQuery.isError
      ? undefined
      : unreadCount > 0
        ? pluralize(unreadCount, { one: nt.unreadOne, other: nt.unreadOther }, locale)
        : nt.allCaughtUp;

  const emptyState = () => {
    if (typeFilter && hasNextPage) {
      return (
        <EmptyState
          title={formatMessage(nt.noTypeLoaded, { type: types[typeFilter] ?? typeFilter })}
          description={nt.noTypeLoadedDesc}
          action={{
            label: isFetchingNextPage ? nt.loadingMore : nt.loadMore,
            onClick: () => {
              if (!isFetchingNextPage) fetchNextPage();
            },
            variant: 'secondary',
          }}
        />
      );
    }
    if (typeFilter) {
      return (
        <EmptyState
          title={formatMessage(nt.noTypeNamed, { type: types[typeFilter] ?? typeFilter })}
          description={nt.emptyDesc}
          action={{ label: nt.viewAll, onClick: () => setActiveTab('all'), variant: 'secondary' }}
        />
      );
    }
    return <EmptyState title={unreadOnly ? nt.noUnread : nt.noNotifications} description={nt.emptyDesc} />;
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={nt.title}
        description={subtitle}
        actions={
          <>
            {unreadCount > 0 && (
              <Button variant="secondary" onClick={() => markAllAsRead.mutate()} loading={markAllAsRead.isPending}>
                {nt.markAllRead}
              </Button>
            )}
            <Button variant="secondary" onClick={() => archiveAllRead.mutate()} loading={archiveAllRead.isPending}>
              {nt.archiveRead}
            </Button>
          </>
        }
      >
        <Tabs
          label={nt.filtersLabel}
          tabs={tabs}
          selectedId={activeTab}
          onSelect={(id) => setActiveTab(id as FilterTab)}
          idPrefix={ID_PREFIX}
          className="border-b-0"
        />
      </PageHeader>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <TabPanel
          idPrefix={ID_PREFIX}
          tabId={activeTab}
          className="mx-auto max-w-[960px] overflow-hidden rounded-xl border border-border bg-white shadow-card"
        >
          {isLoading ? (
            <div aria-busy="true" className="divide-y divide-border">
              <span className="sr-only">{nt.loading}</span>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2 px-5 py-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} error={error} message={nt.loadError} />
          ) : filtered.length === 0 ? (
            emptyState()
          ) : (
            <>
              <ul className="divide-y divide-border">
                {filtered.map((notif) => (
                  <NotificationRow
                    key={notif.id}
                    notification={notif}
                    onMarkRead={(id) => markAsRead.mutate({ id })}
                    onArchive={(id) => archiveSingle.mutate({ id })}
                    onDelete={setDeleteId}
                  />
                ))}
              </ul>
              {hasNextPage && (
                <div className="border-t border-border bg-surface-hover px-5 py-4 text-center">
                  <Button
                    variant="secondary"
                    onClick={() => fetchNextPage()}
                    loading={isFetchingNextPage}
                    loadingLabel={nt.loadingMore}
                  >
                    {nt.loadMore}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabPanel>
      </div>

      {deleteId && (
        <ConfirmDialog
          title={nt.deleteConfirmTitle}
          description={nt.deleteConfirmDesc}
          confirmLabel={nt.delete}
          confirmingLabel={t.common.deleting}
          destructive
          loading={deleteSingle.isPending}
          onConfirm={() => deleteSingle.mutate({ id: deleteId })}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
