'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { Button, RadarChart, Skeleton } from '../../../../../components';
import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import { useFitRankingViaCsharp } from '../../../../../lib/platform-api/fit-engine-reads';

export function CandidateFitPanel({
  candidateId,
  vacancyId,
  onClose,
}: {
  candidateId: string;
  vacancyId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // FIT v2: the row comes from the C# ranking under the flag (D6 for a team leader); the narrative stays on tRPC (its
  // Bedrock pipeline has no C# plane), which builds it from the same D6 view.
  const viaCsharp = isFitEngineV2Enabled();
  const trpcRanking = trpc.fitEngine.getRankingForVacancy.useQuery({ vacancyId }, { enabled: !viaCsharp });
  const csharpRanking = useFitRankingViaCsharp(vacancyId);
  const narrative = trpc.fitEngine.explainFit.useQuery({ candidateId, vacancyId });

  const rows: ReadonlyArray<{ candidateId: string; firstName: string; lastName: string; breakdown: unknown }> =
    (viaCsharp ? csharpRanking.data : trpcRanking.data) ?? [];
  const entry = rows.find((r) => r.candidateId === candidateId);
  const breakdown = entry?.breakdown as Partial<Record<string, number | null>> | null | undefined;

  const dimensions = [
    { label: t.candidates.fitDimensionAssessment, score: breakdown?.assessment ?? null },
    { label: t.candidates.fitDimensionInterview, score: breakdown?.interview ?? null },
    { label: t.candidates.fitDimensionExperience, score: breakdown?.experience ?? null },
    { label: t.candidates.fitDimensionEducation, score: breakdown?.education ?? null },
    { label: t.candidates.fitDimensionLanguages, score: breakdown?.languages ?? null },
  ];

  return (
    <div className="mt-1 rounded-xl bg-white p-4 shadow-card md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-subheading font-semibold text-brand">
          {entry ? `${entry.firstName} ${entry.lastName}` : ''}
        </h3>
        <Button variant="tertiary" size="sm" onClick={onClose}>
          {t.fitRanking.closeDetail}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:items-center">
        {/* The list below is the chart's text equivalent, so the chart itself is hidden from assistive tech. */}
        <div aria-hidden="true">
          <RadarChart dimensions={dimensions} />
        </div>
        <ul aria-label={t.fitRanking.dimensionsLabel} className="divide-y divide-border">
          {dimensions.map((dim) => (
            <li key={dim.label} className="flex min-h-9 items-center justify-between gap-3">
              <span className="text-body text-secondary">{dim.label}</span>
              {dim.score === null ? (
                <span className="text-body text-secondary">{t.candidates.fitDimensionUnavailable}</span>
              ) : (
                <span className="text-body font-medium tabular-nums text-primary">{dim.score}/100</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-2 text-callout font-medium text-secondary">{t.fitRanking.narrativeTitle}</p>
        {narrative.isLoading ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : narrative.isError ? (
          <p role="alert" className="text-callout text-danger">
            {t.fitRanking.narrativeError}
          </p>
        ) : (
          <p className="max-w-prose text-body leading-relaxed text-secondary">{narrative.data?.narrative}</p>
        )}
      </div>
    </div>
  );
}
