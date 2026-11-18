'use client';

import { useId, useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { formatMessage } from '../../../lib/i18n/format';
import { useCan } from '../../../lib/permissions';
import { toast } from '../../../lib/toast';
import { ErrorState } from '../../../components';
import { Button } from '../../../components/button';
import { ProgressBar } from '../../../components/progress-bar';
import { deriveSetupChecklistRows, type SetupChecklistItemKey } from './setup-checklist-rows';
import { isTenantInvitationsEnabled } from '../../../lib/platform-api/tenant-invitations';

function StatusIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-white"
        aria-hidden="true"
      >
        <svg className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </span>
    );
  }
  return <span className="size-5 shrink-0 rounded-full border-2 border-field-border" aria-hidden="true" />;
}

export function SetupChecklist() {
  const { t } = useI18n();
  const sc = t.setupChecklist;
  const utils = trpc.useUtils();
  const can = useCan();
  const canManageBranding = can('organization', 'update');
  const canInviteTeam = can('user', 'create');
  const invitationsEnabled = isTenantInvitationsEnabled();

  // Optimistic client-side hide the instant "hide for now" is clicked, backed
  // by the real dismissSetupChecklist mutation (per Task 4 brief). Reverted on
  // mutation failure so the widget doesn't vanish for a dismissal that never
  // actually persisted.
  const [hiddenOptimistic, setHiddenOptimistic] = useState(false);
  const titleId = useId();

  const statusQuery = trpc.organization.getSetupStatus.useQuery();
  const dismiss = trpc.organization.dismissSetupChecklist.useMutation({
    onSuccess: () => {
      utils.organization.getSetupStatus.invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      setHiddenOptimistic(false);
    },
  });

  if (hiddenOptimistic) return null;

  const data = statusQuery.data;
  // Auto-hides entirely (not just visually collapsed) once everything is
  // done, or once the server confirms a still-fresh dismissal.
  if (data && (data.allComplete || data.dismissedAt !== null)) return null;

  const rows = data
    ? deriveSetupChecklistRows(
        data.items,
        {
          companyStructureReady: sc.companyStructureReady,
          teamInvited: sc.teamInvited,
          brandingSet: sc.brandingSet,
          firstVacancyPosted: sc.firstVacancyPosted,
          firstVacancyPublished: sc.firstVacancyPublished,
        },
        canManageBranding,
        canInviteTeam,
        invitationsEnabled,
      )
    : [];

  // Each pending row's link names its action ("Configurar marca"), not a row of identical "Ir" links.
  const actionLabel: Record<SetupChecklistItemKey, string> = {
    companyStructureReady: sc.goTo,
    teamInvited: sc.actionTeamInvited,
    brandingSet: sc.actionBrandingSet,
    firstVacancyPosted: sc.actionFirstVacancyPosted,
    firstVacancyPublished: sc.actionFirstVacancyPublished,
  };
  const doneCount = rows.filter((r) => r.done).length;
  const progressText = formatMessage(sc.progress, { done: doneCount, total: rows.length });

  const onDismiss = () => {
    setHiddenOptimistic(true);
    dismiss.mutate();
  };

  return (
    <section aria-labelledby={titleId} className="rounded-xl bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-heading font-semibold text-brand">
          {sc.title}
        </h2>
        {data && !statusQuery.isError && (
          <Button variant="tertiary" size="sm" onClick={onDismiss} disabled={dismiss.isPending}>
            {sc.hideForNow}
          </Button>
        )}
      </div>

      {statusQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-8 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : statusQuery.isError || !data ? (
        <ErrorState size="compact" onRetry={() => statusQuery.refetch()} error={statusQuery.error} />
      ) : (
        <>
          <ProgressBar
            className="mb-3 max-w-sm"
            label={sc.progressLabel}
            value={doneCount}
            max={rows.length}
            valueText={progressText}
            tone="success"
          />
          <ol className="space-y-1">
            {rows.map((row) => (
              <li
                key={row.key}
                className="-mx-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusIcon done={row.done} />
                  <span className={`text-body ${row.done ? 'text-secondary' : 'text-primary'}`}>
                    {row.label}
                    <span className="sr-only"> ({row.done ? sc.statusDone : sc.statusPending})</span>
                  </span>
                </div>
                {!row.done && row.href && (
                  <Button href={row.href} variant="tertiary" size="sm" className="shrink-0">
                    {actionLabel[row.key]}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
