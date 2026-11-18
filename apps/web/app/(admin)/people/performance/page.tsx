'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { manifestFor } from '../../../../lib/nav/manifest';
import { Button, PageHeader, TabPanel, Tabs } from '../../../../components';
import { PerformanceKpis } from './performance-kpis';
import { LowProgressAlertsPanel } from './low-progress-alerts';
import { OkrTable } from './okr-table';
import { CoachingPanel } from './coaching-panel';
import { FeedbackPanel } from './feedback-panel';
import { CreateOkrModal } from './create-okr-modal';

type Tab = 'okrs' | 'coaching' | 'feedback';

const TABS_ID = 'performance';

export default function PerformancePage() {
  const { t } = useI18n();
  const { roles, can } = usePermissions();
  const [tab, setTab] = useState<Tab>('okrs');
  const [showOkr, setShowOkr] = useState(false);

  // performance.getLowProgressAlerts calls requireOrgScope(ctx.access) — only
  // super_admin/hr_admin hold an ORG-scoped performance:read grant per
  // seed-access-matrix.ts (hrbp=unit, leader=team, employee=own). Those other
  // roles legitimately reach this same Performance page via their own scoped
  // grant, so rendering this panel unconditionally would 403 them (Codex
  // finding) — gate it to the same two roles the org-rollup KPI widgets on
  // the main dashboard use (pickPrimaryDashboard's 'org'/'hrExec' keys).
  const showLowProgressAlerts = roles.includes('super_admin') || roles.includes('hr_admin');
  // Display only: actions this role cannot complete are not offered (the API still decides).
  const canCreate = can('performance', 'create');
  // Employees reach this page from "Mi desempeño": the title follows the link they tapped.
  const isSelfView = manifestFor(roles).shell === 'participant';

  // --- tRPC queries ---
  const kpisQuery = trpc.performance.getDashboardKpis.useQuery();
  const okrsQuery = trpc.performance.listOkrs.useQuery({ limit: 50 });
  const sessionsQuery = trpc.performance.listCoachingSessions.useQuery({ limit: 25 });
  const commitmentsQuery = trpc.performance.listCommitments.useQuery({ limit: 25 });
  const feedbackQuery = trpc.performance.listFeedback.useQuery({ limit: 25 });
  const recognitionsQuery = trpc.performance.listRecognitions.useQuery({ limit: 25 });

  const tabs = [
    { id: 'okrs', label: t.performance.tabOkrs },
    { id: 'coaching', label: t.performance.tabCoaching },
    { id: 'feedback', label: t.performance.tabFeedback },
  ] as const;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader
        title={isSelfView ? t.sidebar.myPerformance : t.performance.title}
        actions={
          tab === 'okrs' && canCreate ? (
            <Button icon={<PlusIcon />} onClick={() => setShowOkr(true)}>
              {t.performance.newOkr}
            </Button>
          ) : undefined
        }
      >
        <Tabs
          label={t.performance.tabsLabel}
          tabs={tabs}
          selectedId={tab}
          onSelect={(id) => setTab(id as Tab)}
          idPrefix={TABS_ID}
          className="-mx-1 border-b-0"
        />
      </PageHeader>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
        {/* KPIs - visible on all tabs */}
        <PerformanceKpis
          data={kpisQuery.data}
          isLoading={kpisQuery.isLoading}
          isError={kpisQuery.isError}
          error={kpisQuery.error}
          onRetry={() => kpisQuery.refetch()}
        />

        {/* Low-progress alerts - visible on all tabs, links jump to the tab that lists the item.
            Gated to super_admin/hr_admin: the only roles with an org-scoped
            performance:read grant that getLowProgressAlerts requires. */}
        {showLowProgressAlerts && (
          <LowProgressAlertsPanel onSelectOkr={() => setTab('okrs')} onSelectCommitment={() => setTab('coaching')} />
        )}

        <TabPanel idPrefix={TABS_ID} tabId={tab} className="rounded-xl">
          {tab === 'okrs' && (
            <OkrTable
              okrs={okrsQuery.data?.okrs ?? []}
              isLoading={okrsQuery.isLoading}
              isError={okrsQuery.isError}
              error={okrsQuery.error}
              onRetry={() => okrsQuery.refetch()}
              onCreate={canCreate ? () => setShowOkr(true) : undefined}
            />
          )}
          {tab === 'coaching' && (
            <CoachingPanel
              sessions={sessionsQuery.data?.sessions ?? []}
              commitments={commitmentsQuery.data?.commitments ?? []}
              isLoading={sessionsQuery.isLoading || commitmentsQuery.isLoading}
              isError={sessionsQuery.isError || commitmentsQuery.isError}
              error={sessionsQuery.error ?? commitmentsQuery.error}
              onRetry={() => {
                sessionsQuery.refetch();
                commitmentsQuery.refetch();
              }}
              canCreate={canCreate}
            />
          )}
          {tab === 'feedback' && (
            <FeedbackPanel
              feedbacks={feedbackQuery.data?.feedbacks ?? []}
              recognitions={recognitionsQuery.data?.recognitions ?? []}
              isLoading={feedbackQuery.isLoading || recognitionsQuery.isLoading}
              isError={feedbackQuery.isError || recognitionsQuery.isError}
              error={feedbackQuery.error ?? recognitionsQuery.error}
              onRetry={() => {
                feedbackQuery.refetch();
                recognitionsQuery.refetch();
              }}
            />
          )}
        </TabPanel>
      </div>

      {showOkr && <CreateOkrModal onClose={() => setShowOkr(false)} />}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
