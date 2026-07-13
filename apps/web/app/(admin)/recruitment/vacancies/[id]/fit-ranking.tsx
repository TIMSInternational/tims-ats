'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { DataTable, FitScoreBadge, ErrorState } from '../../../../../components';
import { CandidateFitPanel } from './candidate-fit-panel';

const DIMENSIONS = ['assessment', 'interview', 'experience', 'education', 'languages'] as const;
type Dimension = (typeof DIMENSIONS)[number];
const EVEN_WEIGHTS: Record<Dimension, number> = {
  assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2,
};

export function FitRanking({ vacancyId }: { vacancyId: string }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [hypotheticalWeights, setHypotheticalWeights] = useState<Record<Dimension, number>>(EVEN_WEIGHTS);

  const ranking = trpc.fitEngine.getRankingForVacancy.useQuery({ vacancyId });

  const compute = trpc.fitEngine.computeForVacancy.useMutation({
    onSuccess: (result) => {
      toast(t.fitRanking.computeSuccess.replace('{count}', String(result.computed)), { type: 'success' });
      utils.fitEngine.getRankingForVacancy.invalidate({ vacancyId });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  // Non-destructive what-if simulator (Codex-review fix): re-runs the
  // weighted-sum math in memory against already-stored FitScore breakdowns —
  // zero writes, zero AI calls. Kept as a manually-triggered query (enabled:
  // false + refetch) rather than a mutation because simulateWeights is a
  // side-effect-free read, matching the router's `.query` procedure.
  const simulation = trpc.fitEngine.simulateWeights.useQuery(
    { vacancyId, hypotheticalWeights },
    { enabled: false },
  );

  const weightLabels: Record<Dimension, string> = {
    assessment: t.fitWeights.weightAssessment,
    interview: t.fitWeights.weightInterview,
    experience: t.fitWeights.weightExperience,
    education: t.fitWeights.weightEducation,
    languages: t.fitWeights.weightLanguages,
  };

  const weightSum = DIMENSIONS.reduce((sum, dim) => sum + hypotheticalWeights[dim], 0);
  const weightsValid = Math.abs(weightSum - 1) < 0.001;

  const rows = ranking.data ?? [];

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.fitRanking.title}</h3>
        <button
          onClick={() => compute.mutate({ vacancyId })}
          disabled={compute.isPending}
          className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-3 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {compute.isPending ? t.fitRanking.computing : t.fitRanking.computeButton}
        </button>
      </div>

      {ranking.isError ? (
        <ErrorState onRetry={() => ranking.refetch()} />
      ) : (
        <DataTable
          loading={ranking.isLoading}
          columns={[
            { key: 'candidate', label: t.fitRanking.colCandidate },
            { key: 'score', label: t.fitRanking.colScore, align: 'center' },
            { key: 'status', label: t.fitRanking.colStatus, align: 'center' },
            { key: 'actions', label: '', align: 'right' },
          ]}
          empty={<p className="text-[12px] text-[#8B8B8B] py-4 text-center">{t.fitRanking.empty}</p>}
        >
          {rows.map((r) => (
            <tr key={r.candidateId} className="border-b border-[#F6F6F6]">
              <td className="px-4 py-3 text-[13px] text-[#333]">{r.firstName} {r.lastName}</td>
              <td className="px-4 py-3 text-center">
                <FitScoreBadge score={r.overallScore} size="sm" />
              </td>
              <td className="px-4 py-3 text-center text-[11px] text-[#8B8B8B]">
                {r.isPartial ? t.fitRanking.statusPartial : t.fitRanking.statusComplete}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => setExpandedCandidateId(expandedCandidateId === r.candidateId ? null : r.candidateId)}
                  className="text-[11px] text-[#1F114C] hover:underline"
                >
                  {t.fitRanking.viewDetail}
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {expandedCandidateId && (
        <CandidateFitPanel
          candidateId={expandedCandidateId}
          vacancyId={vacancyId}
          onClose={() => setExpandedCandidateId(null)}
        />
      )}

      <div className="mt-4 pt-4 border-t border-[#EDEDED]">
        <button
          onClick={() => setShowSimulator((s) => !s)}
          className="text-[12px] text-[#1F114C] hover:underline font-medium"
        >
          {showSimulator ? t.fitRanking.simulateHide : t.fitRanking.simulateShow}
        </button>

        {showSimulator && (
          <div className="mt-3 bg-[#F6F6F6] rounded-lg p-4">
            <p className="text-[11px] text-[#8B8B8B] mb-3">{t.fitRanking.simulateDescription}</p>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
              {DIMENSIONS.map((dim) => (
                <div key={dim}>
                  <label className="block text-[11px] font-medium text-[#585858] mb-1">{weightLabels[dim]}</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={hypotheticalWeights[dim]}
                    onChange={(e) => setHypotheticalWeights((w) => ({ ...w, [dim]: Number(e.target.value) }))}
                    className="w-full bg-white border border-[#EDEDED] rounded-lg px-2 h-8 text-[12px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => simulation.refetch()}
                disabled={!weightsValid || simulation.isFetching}
                className="bg-[#1F114C] text-white px-3 h-8 rounded-lg text-[12px] font-medium hover:bg-[#180d3a] transition disabled:opacity-50"
              >
                {simulation.isFetching ? t.fitRanking.simulateRunning : t.fitRanking.simulateRun}
              </button>
              <p className={`text-[11px] ${weightsValid ? 'text-[#8B8B8B]' : 'text-[#DD0C15]'}`}>
                {t.fitWeights.sumHint} ({weightSum.toFixed(2)})
              </p>
            </div>

            {simulation.data && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[#8B8B8B] mb-2">{t.fitRanking.simulateResultsLabel}</p>
                <div className="space-y-1.5">
                  {simulation.data.map((row) => (
                    <div key={row.candidateId} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                      <span className="text-[12px] text-[#333]">{row.firstName} {row.lastName}</span>
                      <FitScoreBadge score={row.simulatedScore} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
