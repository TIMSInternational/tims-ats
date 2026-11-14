'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../../../../components';
import { CreateFlagModal } from './create-flag-modal';
import { FlagOverridesPanel } from './flag-overrides-panel';

const TH = 'px-4 py-3 text-callout font-medium text-secondary';

export default function PlatformFeatureFlagsPage() {
  const { t } = useI18n();
  const ff = t.featureFlags;
  const descriptions = ff.descriptions as Record<string, string>;
  const utils = trpc.useUtils();
  const { data: flagGroups, isLoading, isError, error, refetch } = trpc.platform.listAllFeatureFlags.useQuery();

  const [localToggles, setLocalToggles] = useState<Record<string, boolean>>({});
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<{ key: string; message: string } | null>(null);
  const [selectedFlagKey, setSelectedFlagKey] = useState<string>('');
  const [focusPanel, setFocusPanel] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);

  const flags = useMemo(() => flagGroups ?? [], [flagGroups]);
  const activeFlagKey = selectedFlagKey || (flags.length > 0 ? flags[0].key : '');
  const selectedFlagEntries = useMemo(
    () => flags.find((f) => f.key === activeFlagKey)?.entries ?? [],
    [flags, activeFlagKey],
  );

  // Choosing a flag in the table updates the panel below it: bring the panel into view and move focus there.
  useEffect(() => {
    if (focusPanel === 0 || !panelHeadingRef.current) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panelHeadingRef.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    panelHeadingRef.current.focus({ preventScroll: true });
  }, [focusPanel]);

  const invalidateAll = () => {
    utils.platform.listAllFeatureFlags.invalidate();
  };

  const updateFlag = trpc.platform.updateFeatureFlag.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(ff.updated, { type: 'success' });
    },
  });
  const seedFlags = trpc.platform.seedFeatureFlags.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(ff.seedSuccess, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });
  const createFlag = trpc.platform.createFeatureFlagForAllOrgs.useMutation({
    onSuccess: () => {
      invalidateAll();
      setShowCreateModal(false);
      toast(ff.flagCreated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });
  const deleteFlag = trpc.platform.deleteFeatureFlagByKey.useMutation({
    onSuccess: () => {
      invalidateAll();
      setDeleteTarget(null);
      toast(ff.flagDeleted, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  function handleToggle(orgId: string, key: string, currentEnabled: boolean) {
    const rowKey = `${orgId}:${key}`;
    const newEnabled = !currentEnabled;
    setToggleError(null);
    setPendingToggle(rowKey);
    setLocalToggles((prev) => ({ ...prev, [rowKey]: newEnabled }));
    updateFlag.mutate(
      { organizationId: orgId, key, enabled: newEnabled },
      {
        // The save failed: drop the optimistic value so the row shows what is really stored.
        onError: (err) => {
          setLocalToggles((prev) => {
            const next = { ...prev };
            delete next[rowKey];
            return next;
          });
          setToggleError({ key: rowKey, message: err.message });
        },
        onSettled: () => setPendingToggle(null),
      },
    );
  }

  function getEffectiveEnabled(orgId: string, key: string, dbEnabled: boolean): boolean {
    const toggleKey = `${orgId}:${key}`;
    if (toggleKey in localToggles) return localToggles[toggleKey];
    return dbEnabled;
  }

  const isEmpty = !isLoading && !isError && flags.length === 0;
  const seedAction = {
    label: seedFlags.isPending ? ff.seeding : ff.seedFlags,
    onClick: () => {
      if (!seedFlags.isPending) seedFlags.mutate();
    },
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t.platformSidebar.featureFlags}
        description={ff.infoBanner}
        actions={<Button onClick={() => setShowCreateModal(true)}>{ff.createFlag}</Button>}
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        <div className="overflow-hidden rounded-xl bg-white shadow-card">
          {isLoading ? (
            <div aria-busy="true" className="divide-y divide-border">
              <span className="sr-only">{ff.loading}</span>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-5 w-10" />
                  <Skeleton className="h-7 w-24" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} error={error} message={ff.loadError} />
          ) : isEmpty ? (
            <EmptyState
              title={ff.noFlags}
              description={ff.noFlagsDesc}
              action={{ ...seedAction, variant: 'secondary' }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>{ff.flagKey}</th>
                    <th className={TH}>{ff.description}</th>
                    <th className={`${TH} text-center`}>{ff.orgsActive}</th>
                    <th className={`${TH} text-center`}>{ff.overrides}</th>
                    <th className={TH}>{ff.lastModified}</th>
                    <th className={TH}>{ff.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {flags.map((group) => {
                    const enabledCount = group.entries.filter((e) => e.enabled).length;
                    const isActive = activeFlagKey === group.key;
                    return (
                      <tr key={group.key} className={isActive ? 'bg-brand-tint/40' : 'hover:bg-surface-hover'}>
                        <td className="px-4 py-3">
                          <code className="rounded bg-brand-tint px-2 py-0.5 font-mono text-callout text-brand">
                            {group.key}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-body text-secondary">
                          {descriptions[group.key] ?? ff.customFlag}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge
                            tone={enabledCount > 0 ? 'success' : 'neutral'}
                            icon="none"
                            className="tabular-nums"
                          >
                            {enabledCount}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-center text-body tabular-nums text-primary">
                          {group.entries.length}
                        </td>
                        <td className="px-4 py-3 text-body text-secondary">
                          {group.latestUpdate ? formatDate(group.latestUpdate) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-pressed={isActive}
                              onClick={() => {
                                setSelectedFlagKey(group.key);
                                setFocusPanel((n) => n + 1);
                              }}
                            >
                              {ff.configure}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive-secondary"
                              onClick={() => setDeleteTarget(group.key)}
                            >
                              {ff.delete}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && !isError && activeFlagKey && (
          <FlagOverridesPanel
            ref={panelHeadingRef}
            flagKey={activeFlagKey}
            entries={selectedFlagEntries}
            isEnabled={getEffectiveEnabled}
            pendingToggle={pendingToggle}
            toggleError={toggleError}
            onToggle={handleToggle}
          />
        )}
      </div>

      {showCreateModal && (
        <CreateFlagModal
          isPending={createFlag.isPending}
          onCreate={(input) => createFlag.mutate(input)}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={ff.confirmDelete}
          description={ff.confirmDeleteDesc}
          confirmLabel={ff.delete}
          confirmingLabel={t.common.deleting}
          destructive
          loading={deleteFlag.isPending}
          onConfirm={() => deleteFlag.mutate({ key: deleteTarget })}
          onCancel={() => setDeleteTarget(null)}
        >
          <code className="block rounded bg-surface px-2 py-1 font-mono text-body text-primary">{deleteTarget}</code>
        </ConfirmDialog>
      )}
    </div>
  );
}
