'use client';

import { useTeamIntelDashboardKpis } from '../../../../lib/platform-api/team-intel';
import { useI18n } from '../../../../lib/i18n';
import { PageHeader } from '../../../../components';
import { TeamIntelKpis } from './team-intel-kpis';
import { UpcomingViewsCard } from './upcoming-views-card';

export default function TeamIntelligencePage() {
  const { t } = useI18n();
  const kpis = useTeamIntelDashboardKpis();

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* The KPIs are organisation-wide: say so, rather than showing a team selector that does nothing. */}
      <PageHeader title={t.teamIntel.title} description={t.teamIntel.scopeAll} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <TeamIntelKpis
          data={kpis.data}
          loading={kpis.isLoading}
          error={kpis.isError ? kpis.error : null}
          onRetry={() => kpis.refetch()}
        />
        <UpcomingViewsCard />
      </div>
    </div>
  );
}
