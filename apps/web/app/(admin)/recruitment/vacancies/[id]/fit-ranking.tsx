'use client';

import { Fragment, useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Button, DataTable, ErrorState, FitScoreBadge, TextInput } from '../../../../../components';
import { formatMessage } from '../../../../../lib/i18n/format';
import { CandidateFitPanel } from './candidate-fit-panel';
import { AiSuggestionNotice } from '../../../../../components/ai-suggestion-notice';
import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import {
  useComputeForVacancyViaCsharp,
  useFitRankingViaCsharp,
  useSimulateWeightsViaCsharp,
} from '../../../../../lib/platform-api/fit-engine-reads';

const DIMENSIONS = ['assessment', 'interview', 'experience', 'education', 'languages'] as const;
type Dimension = (typeof DIMENSIONS)[number];
const EVEN_WEIGHTS: Record<Dimension, number> = {
  assessment: 0.2,
  interview: 0.2,
  experience: 0.2,
  education: 0.2,
  languages: 0.2,
};

export function FitRanking({ vacancyId }: { vacancyId: string }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [hypotheticalWeights, setHypotheticalWeights] = useState<Record<Dimension, number>>(EVEN_WEIGHTS);

  // FIT v2 (NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP): the ranking, the what-if and the compute go to C#, which redacts for
  // a team leader (D6) and computes v2. Flag off: the tRPC procedures, unchanged.
  const viaCsharp = isFitEngineV2Enabled();
  const trpcRanking = trpc.fitEngine.getRankingForVacancy.useQuery({ vacancyId }, { enabled: !viaCsharp });
  const csharpRanking = useFitRankingViaCsharp(vacancyId);
  const ranking = viaCsharp ? csharpRanking : trpcRanking;

  const onComputed = (computed: number) =>
    toast(t.fitRanking.computeSuccess.replace('{count}', String(computed)), { type: 'success' });
  const trpcCompute = trpc.fitEngine.computeForVacancy.useMutation({
    onSuccess: (result) => {
      onComputed(result.computed);
      utils.fitEngine.getRankingForVacancy.invalidate({ vacancyId });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });
  const csharpCompute = useComputeForVacancyViaCsharp(vacancyId, {
    onSuccess: onComputed,
    onError: (err) => toast(err.message, { type: 'error' }),
  });
  const compute = viaCsharp
    ? { run: () => csharpCompute.mutate(), isPending: csharpCompute.isPending }
    : { run: () => trpcCompute.mutate({ vacancyId }), isPending: trpcCompute.isPending };

  // Non-destructive what-if simulator (Codex-review fix): re-runs the
  // weighted-sum math in memory against already-stored FitScore breakdowns —
  // zero writes, zero AI calls. Kept as a manually-triggered query (enabled:
  // false + refetch) rather than a mutation because simulateWeights is a
  // side-effect-free read, matching the router's `.query` procedure.
  const trpcSimulation = trpc.fitEngine.simulateWeights.useQuery(
    { vacancyId, hypotheticalWeights },
    { enabled: false },
  );
  const csharpSimulation = useSimulateWeightsViaCsharp(vacancyId, hypotheticalWeights);
  const simulation = viaCsharp ? csharpSimulation : trpcSimulation;

  const weightLabels: Record<Dimension, string> = {
    assessment: t.fitWeights.weightAssessment,
    interview: t.fitWeights.weightInterview,
    experience: t.fitWeights.weightExperience,
    education: t.fitWeights.weightEducation,
    languages: t.fitWeights.weightLanguages,
  };

  const weightSum = DIMENSIONS.reduce((sum, dim) => sum + hypotheticalWeights[dim], 0);
  const weightsValid = Math.abs(weightSum - 1) < 0.001;

  const rows: ReadonlyArray<{
    candidateId: string;
    firstName: string;
    lastName: string;
    overallScore: number;
    isPartial: boolean;
  }> = ranking.data ?? [];

  const toPercent = (weight: number) => Math.round(weight * 100);

  return (
    <div className="rounded-xl bg-white p-4 shadow-card md:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-subheading font-semibold text-brand">{t.fitRanking.title}</h3>
        {/* Secondary: recomputing is a maintenance action, not the page's main task (buttons.md › Style). */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => compute.run()}
          loading={compute.isPending}
          loadingLabel={t.fitRanking.computing}
        >
          {t.fitRanking.computeButton}
        </Button>
      </div>
      <AiSuggestionNotice className="mb-4" />

      {ranking.isError ? (
        <ErrorState onRetry={() => ranking.refetch()} error={ranking.error} />
      ) : (
        <DataTable
          loading={ranking.isLoading}
          label={t.fitRanking.title}
          columns={[
            { key: 'candidate', label: t.fitRanking.colCandidate },
            { key: 'score', label: t.fitRanking.colScore, align: 'center' },
            { key: 'status', label: t.fitRanking.colStatus, align: 'center' },
            { key: 'actions', label: t.fitRanking.viewDetail, align: 'right', srOnly: true },
          ]}
          empty={<p className="py-4 text-center text-body text-secondary">{t.fitRanking.empty}</p>}
        >
          {rows.map((r) => {
            const open = expandedCandidateId === r.candidateId;
            const detailId = `fit-detail-${r.candidateId}`;
            return (
              <Fragment key={r.candidateId}>
                <tr className={`border-b border-border ${open ? 'bg-brand-tint' : ''}`}>
                  <td className="px-4 py-3 text-body text-primary">
                    {r.firstName} {r.lastName}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <FitScoreBadge score={r.overallScore} size="sm" showBand />
                  </td>
                  <td className="px-4 py-3 text-center text-callout text-secondary">
                    {r.isPartial ? t.fitRanking.statusPartial : t.fitRanking.statusComplete}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="tertiary"
                      size="sm"
                      aria-expanded={open}
                      aria-controls={open ? detailId : undefined}
                      onClick={() => setExpandedCandidateId(open ? null : r.candidateId)}
                    >
                      {open ? t.fitRanking.hideDetail : t.fitRanking.viewDetail}
                    </Button>
                  </td>
                </tr>
                {open && (
                  <tr id={detailId} className="border-b border-border bg-brand-tint">
                    <td colSpan={4} className="px-4 pb-4">
                      <CandidateFitPanel
                        candidateId={r.candidateId}
                        vacancyId={vacancyId}
                        onClose={() => setExpandedCandidateId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </DataTable>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <Button
          variant="tertiary"
          size="sm"
          className="-ml-3"
          aria-expanded={showSimulator}
          onClick={() => setShowSimulator((s) => !s)}
        >
          {showSimulator ? t.fitRanking.simulateHide : t.fitRanking.simulateShow}
        </Button>

        {showSimulator && (
          <div className="mt-3 rounded-lg bg-surface p-4">
            <p className="mb-3 text-callout text-secondary">{t.fitRanking.simulateDescription}</p>

            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              {DIMENSIONS.map((dim) => (
                <div key={dim}>
                  <label htmlFor={`fit-sim-${dim}`} className="mb-1.5 block text-callout font-medium text-primary">
                    {weightLabels[dim]}
                  </label>
                  <div className="relative">
                    <TextInput
                      id={`fit-sim-${dim}`}
                      aria-describedby="fit-sim-sum"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={5}
                      value={toPercent(hypotheticalWeights[dim])}
                      onChange={(e) => setHypotheticalWeights((w) => ({ ...w, [dim]: Number(e.target.value) / 100 }))}
                      className="pr-7 tabular-nums"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-body text-secondary"
                    >
                      %
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Button
                onClick={() => simulation.refetch()}
                disabled={!weightsValid}
                loading={simulation.isFetching}
                loadingLabel={t.fitRanking.simulateRunning}
              >
                {t.fitRanking.simulateRun}
              </Button>
              <p
                id="fit-sim-sum"
                role="status"
                className={`text-callout ${weightsValid ? 'text-secondary' : 'font-medium text-danger'}`}
              >
                {formatMessage(t.fitWeights.sumOf, { sum: toPercent(weightSum) })}
              </p>
            </div>

            {simulation.data && (
              <div>
                <p className="mb-2 text-caption font-medium uppercase tracking-wide text-secondary">
                  {t.fitRanking.simulateResultsLabel}
                </p>
                <ul className="space-y-1.5">
                  {simulation.data.map((row) => (
                    <li
                      key={row.candidateId}
                      className="flex items-center justify-between rounded-lg bg-white px-3 py-2"
                    >
                      <span className="text-body text-primary">
                        {row.firstName} {row.lastName}
                      </span>
                      <FitScoreBadge score={row.simulatedScore} size="sm" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
