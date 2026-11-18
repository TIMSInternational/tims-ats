'use client';

import { useState } from 'react';
import { useMonitoringExecutiveKpis } from '../../../lib/platform-api/monitoring';
import { useI18n } from '../../../lib/i18n';
import { PageHeader } from '../../../components/page-header';
import { Button } from '../../../components/button';
import { MonitoringKpis } from './monitoring-kpis';
import { ModuleHealthGrid } from './monitoring-modules';
import { AlertsPanel } from './monitoring-alerts';
import { ActionPlanAlerts } from './monitoring-action-plans';
import { CrossModuleTrend } from './monitoring-bottom';
import { AlertRulesModal } from './alert-rules-modal';

function BellIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

/**
 * Strategic monitoring. The page scrolls at every width (no fixed-height rows that clip content), and its
 * one real command, "Configurar alertas…", is the single primary action. The export and quick-action
 * buttons that only answered "próximamente" are gone until those commands exist (feedback.md).
 */
export default function MonitoringPage() {
  const { t } = useI18n();
  const kpis = useMonitoringExecutiveKpis();
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader
        title={t.monitoring.title}
        description={t.monitoring.subtitle}
        actions={
          <Button icon={<BellIcon />} onClick={() => setShowRules(true)}>
            {t.monitoring.configureAlerts}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <div className="space-y-6">
          <MonitoringKpis
            data={kpis.data ?? null}
            loading={kpis.isLoading}
            isError={kpis.isError}
            onRetry={() => kpis.refetch()}
          />

          <ModuleHealthGrid />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <AlertsPanel />
            <ActionPlanAlerts />
          </div>

          <CrossModuleTrend />
        </div>
      </div>

      {showRules && <AlertRulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
