'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { CandidateAvatar, ErrorState } from '../../../components';
import { StatusBadge } from '../../../components/status-badge';
import { useId, useMemo } from 'react';

function daysAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function hoursAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, (Date.now() - d.getTime()) / 3600000);
}

interface RiskItem {
  id: string;
  candidateId: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  title: string;
  riskLabel: string;
  riskColor: string;
  nextStep: string;
  days: number;
}

interface AlertsRiskPanelProps {
  vacancyId: string | undefined;
  vacanciesLoading: boolean;
}

export function AlertsRiskPanel({ vacancyId, vacanciesLoading }: AlertsRiskPanelProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  const board = trpc.pipeline.getBoard.useQuery(
    { vacancyId: vacancyId!, status: 'active' },
    { enabled: !!vacancyId, staleTime: 60_000 },
  );

  const riskCandidates = useMemo<RiskItem[]>(() => {
    if (!board.data?.stages) return [];

    const risks: RiskItem[] = [];

    for (const stage of board.data.stages) {
      for (const app of stage.applications) {
        // Risk is measured by time-in-CURRENT-stage, not time since the
        // original application — a card long in the pipeline overall but
        // freshly moved into this stage isn't overdue or stalled.
        const days = daysAgo(app.enteredStageAt);
        const isOverdue = stage.slaHours != null && hoursAgo(app.enteredStageAt) > stage.slaHours;
        const isStalled = days > 7;

        if (!isOverdue && !isStalled) continue;

        const c = app.candidate as {
          id: string;
          firstName: string;
          lastName: string;
          avatar: string | null;
          currentTitle?: string | null;
        };

        // A fixed rule (time in stage vs. the stage SLA), not an AI suggestion — labelled as a next step.
        const fill = (template: string) =>
          template.replace('{days}', String(days)).replace('{stage}', () => stage.name);
        let riskLabel: string;
        let riskColor: string;
        let nextStep: string;

        if (isOverdue && days > 10) {
          riskLabel = fill(rd.stalledDays);
          riskColor = 'text-danger';
          nextStep = rd.nextStepActNow;
        } else if (isOverdue) {
          riskLabel = fill(rd.slaOverdueInStage);
          riskColor = 'text-danger';
          nextStep = rd.nextStepReviewAndAdvance;
        } else {
          riskLabel = fill(rd.noMovementDays);
          riskColor = 'text-warning';
          nextStep = rd.nextStepFollowUp;
        }

        risks.push({
          id: app.id,
          candidateId: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          avatar: c.avatar,
          title: c.currentTitle ?? stage.name,
          riskLabel,
          riskColor,
          nextStep,
          days,
        });
      }
    }

    // Sort by days stalled (most stalled first), limit to 4
    return risks.sort((a, b) => b.days - a.days).slice(0, 4);
  }, [board.data, rd]);

  const isLoading = vacanciesLoading || board.isLoading;
  const titleId = useId();
  const alertCount = riskCandidates.length;

  return (
    <section aria-labelledby={titleId} className="w-full rounded-xl bg-white p-4 shadow-card md:flex-1">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-subheading font-semibold text-brand">
          {rd.riskCandidates}
        </h3>
        {/* Red only when there is something to act on; at 0 it reads "Sin alertas" in neutral text. */}
        {alertCount > 0 ? (
          <StatusBadge tone="danger" icon="none" className="tabular-nums">
            {alertCount} {rd.alerts}
          </StatusBadge>
        ) : (
          <span className="text-callout text-secondary">{rd.noAlerts}</span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-16 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : board.isError ? (
        <ErrorState size="compact" onRetry={() => board.refetch()} error={board.error} />
      ) : alertCount === 0 ? (
        <div className="py-6 text-center">
          <div
            className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-success-bg"
            aria-hidden="true"
          >
            <svg className="size-4 text-success" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-callout text-secondary">{rd.noRiskCandidates}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {riskCandidates.map((c) => (
            <li key={c.id}>
              <div className="flex items-center gap-3">
                <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" decorative />
                <div className="min-w-0 flex-1">
                  <p className="text-body text-primary">
                    {c.firstName} {c.lastName}
                  </p>
                  <p className="text-caption text-muted">{c.title}</p>
                  <p className={`text-caption font-medium ${c.riskColor}`}>{c.riskLabel}</p>
                </div>
              </div>
              <p className="ml-10 mt-1 text-caption text-secondary">
                <span className="font-medium text-primary">{rd.aiSuggestion}:</span> {c.nextStep}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
