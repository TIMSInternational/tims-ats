'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { useEngagementEnps, useEngagementDashboardKpis } from '../../../../lib/platform-api/engagement';
import { Button, ErrorState, PageHeader } from '../../../../components';
import { isForbiddenError } from '../../../../lib/forbidden-error';
import { ClimateKpis } from './climate-kpis';
import { ClimateHeatmap } from './climate-heatmap';
import { ClimateResults } from './climate-results';
import { CommentsAnalysis, LowClimateAlerts } from './climate-sidebar';
import { ActionPlans, LeaderCommitments } from './climate-bottom';
import { LaunchSurveyModal } from './launch-survey-modal';

export default function ClimatePage() {
  const { t } = useI18n();
  const enps = useEngagementEnps();
  const kpis = useEngagementDashboardKpis();
  const [showLaunch, setShowLaunch] = useState(false);

  // A denial (or any failure of the two page-level reads) is said once, for the whole page, instead of
  // repeating the same red line in every card. ErrorState turns a 403 into "no access" with no retry.
  const pageError = enps.isError ? enps.error : kpis.isError ? kpis.error : null;
  // While the page says "no access", it does not also offer "Lanzar encuesta": the user cannot take it
  // (feedback.md › Best practices). Presentation only — the server still decides who may launch.
  const isDenied = isForbiddenError(pageError);

  return (
    <>
      <div className="flex flex-col flex-1 min-w-0 h-full">
        <PageHeader
          title={t.sidebar.climate}
          description={t.climate.pageDescription}
          actions={
            isDenied ? undefined : (
              <Button
                onClick={() => setShowLaunch(true)}
                icon={
                  <svg
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                }
              >
                {t.climate.launchSurvey}
              </Button>
            )
          }
        />

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {pageError ? (
            <ErrorState
              title={t.climate.errPage}
              error={pageError}
              onRetry={() => {
                enps.refetch();
                kpis.refetch();
              }}
            />
          ) : (
            <>
              <ClimateKpis
                enps={enps.data ?? null}
                dashKpis={kpis.data ?? null}
                loading={enps.isLoading || kpis.isLoading}
              />

              <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[11fr_9fr]">
                <div className="flex flex-col gap-4">
                  <ClimateHeatmap />
                  <ClimateResults />
                </div>
                <LowClimateAlerts />
              </div>

              <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[11fr_9fr]">
                <ActionPlans />
                <LeaderCommitments />
              </div>

              <CommentsAnalysis />
            </>
          )}
        </div>
      </div>
      {showLaunch && !isDenied && <LaunchSurveyModal onClose={() => setShowLaunch(false)} />}
    </>
  );
}
