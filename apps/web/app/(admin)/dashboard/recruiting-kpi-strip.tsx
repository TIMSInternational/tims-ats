'use client';

import { useI18n } from '../../../lib/i18n';
import type { VacancyDashboardKpis, CandidateKpis } from '../../../lib/trpc-types';
import { ErrorState } from '../../../components';

interface KpiItem {
  testId: string;
  label: string;
  value: number;
  /** Status colour for the number; applied only when the value is above zero (nothing to act on at 0). */
  tone?: 'warning' | 'danger';
  subtitle?: string;
  /** Status colour for the caption, applied only when `subtitleCount` is above zero. */
  subtitleTone?: 'warning' | 'success';
  subtitleCount?: number;
}

const VALUE_TONE: Record<NonNullable<KpiItem['tone']>, string> = {
  warning: 'text-warning',
  danger: 'text-danger',
};

const CAPTION_TONE: Record<NonNullable<KpiItem['subtitleTone']>, string> = {
  warning: 'text-warning',
  success: 'text-success',
};

const CARD = 'flex flex-col gap-1 rounded-xl bg-white p-4 shadow-card';

function KpiCardMini({ testId, label, value, tone, subtitle, subtitleTone, subtitleCount }: KpiItem) {
  const valueColour = tone && value > 0 ? VALUE_TONE[tone] : 'text-primary';
  const captionColour = subtitleTone && (subtitleCount ?? 0) > 0 ? CAPTION_TONE[subtitleTone] : 'text-secondary';
  return (
    <div data-testid={testId} className={CARD}>
      <span className="text-callout text-secondary">{label}</span>
      <span className={`font-display text-title font-bold tabular-nums md:text-display ${valueColour}`}>{value}</span>
      {subtitle && <span className={`text-caption font-medium ${captionColour}`}>{subtitle}</span>}
    </div>
  );
}

const GRID = 'mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5';

function KpiStripSkeleton() {
  const { t } = useI18n();
  return (
    <div className={GRID} aria-busy="true">
      <span className="sr-only">{t.common.loadingContent}</span>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`${CARD} animate-pulse motion-reduce:animate-none`} aria-hidden="true">
          <div className="mb-2 h-3 w-20 rounded bg-gray-200" />
          <div className="mb-1 h-7 w-12 rounded bg-gray-200" />
          <div className="h-3 w-16 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

interface RecruitingKpiStripProps {
  vacancyKpis: VacancyDashboardKpis | undefined;
  candidateKpis: CandidateKpis | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

export function RecruitingKpiStrip({
  vacancyKpis,
  candidateKpis,
  isLoading,
  isError,
  onRetry,
}: RecruitingKpiStripProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  if (isLoading) return <KpiStripSkeleton />;

  if (isError) {
    return (
      <div className="mb-6">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  const vk = vacancyKpis;
  const ck = candidateKpis;

  // RH-02: every card is a real count from the two KPI queries, labelled for what it actually
  // counts. Cards with no backing metric (interviews today, pending offers, abandonment risk) were
  // removed rather than filled with proxies; captions are either a real count or a plain description.
  const pendingApproval = vk?.totalPendingApproval ?? 0;
  const slaOverdue = vk?.totalSlaOverdue ?? 0;
  const newThisMonth = ck?.newThisMonth ?? 0;
  const cards: KpiItem[] = [
    {
      testId: 'kpi-open-vacancies',
      label: rd.openVacancies,
      value: vk?.totalOpen ?? 0,
      subtitle: `${pendingApproval} ${rd.pendingApproval}`,
      subtitleTone: 'warning',
      subtitleCount: pendingApproval,
    },
    {
      testId: 'kpi-sla-overdue',
      label: rd.slaOverdue,
      value: slaOverdue,
      tone: 'danger',
      subtitle: rd.requireAction,
      subtitleTone: 'warning',
      subtitleCount: slaOverdue,
    },
    {
      testId: 'kpi-drafts',
      label: rd.drafts,
      value: vk?.totalDraft ?? 0,
    },
    {
      testId: 'kpi-active-candidates',
      label: rd.activeCandidates,
      value: ck?.total ?? 0,
      subtitle: `+${newThisMonth} ${rd.thisMonth}`,
      subtitleTone: 'success',
      subtitleCount: newThisMonth,
    },
    {
      testId: 'kpi-active-applications',
      label: rd.activeApplications,
      value: ck?.activeApplications ?? 0,
      subtitle: rd.inPipeline,
    },
  ];

  return (
    <div className={GRID}>
      {cards.map((card) => (
        <KpiCardMini key={card.label} {...card} />
      ))}
    </div>
  );
}
