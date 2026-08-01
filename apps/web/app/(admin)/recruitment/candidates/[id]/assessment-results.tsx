'use client';

import { useI18n } from '../../../../../lib/i18n';
import { DiscChart } from '../../../../../components';

interface Assignment {
  id: string;
  status: string;
  assignedAt: Date | string;
  completedAt: Date | string | null;
  assessmentType: { id: string; name: string; code: string };
  // rawScore + breakdown are restricted Psychometric Raw (super_admin only) and
  // are no longer returned on the candidate-detail path (Wave 2.5 slice 6), so
  // they are optional here. The render guards below already null/undefined-check.
  result: {
    id: string;
    rawScore?: number | null;
    normalizedScore: number | null;
    percentile?: number | null;
    band?: 'below_average' | 'average' | 'above_average' | 'excellent' | null;
    normSampleSize?: number | null;
    breakdown?: unknown;
  } | null;
}

interface FitScore {
  id: string;
  overallScore: number;
  breakdown: unknown;
  calculatedAt: Date | string;
}

function StatusLabel({ status }: { status: string }) {
  const { t } = useI18n();
  const cls =
    status === 'completed'
      ? 'bg-green-50 text-green-600'
      : status === 'in_progress'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-gray-100 text-gray-600';
  const label = status === 'completed' ? t.candidates.completed : status;
  return <span className={`text-[12px] font-medium px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

function DiscScoreBoxes({ breakdown }: { breakdown: Record<string, number> }) {
  const dims = [
    { key: 'D', value: breakdown.dominance ?? 0 },
    { key: 'I', value: breakdown.influence ?? 0 },
    { key: 'S', value: breakdown.steadiness ?? 0 },
    { key: 'C', value: breakdown.compliance ?? 0 },
  ];

  return (
    <div className="flex gap-2">
      {dims.map((d) => (
        <div key={d.key} className="flex-1 bg-[#F6F6F6] rounded p-2 text-center">
          <p className="text-[10px] text-[#8B8B8B]">{d.key}</p>
          <p className="text-[14px] font-bold text-[#1F114C]">{d.value}</p>
        </div>
      ))}
    </div>
  );
}

function BreakdownGrid({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).slice(0, 6);
  return (
    <div className="grid grid-cols-3 gap-2 mt-2">
      {entries.map(([key, val]) => (
        <div key={key} className="bg-[#F6F6F6] rounded p-2 text-center">
          <p className="text-[9px] text-[#8B8B8B] capitalize">{key}</p>
          <p className="text-[13px] font-bold text-[#1F114C]">{String(val)}</p>
        </div>
      ))}
    </div>
  );
}

function AssessmentRow({ name, status, children }: { name: string; status: string; children?: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[#585858]">{name}</span>
        <StatusLabel status={status} />
      </div>
      {children}
    </div>
  );
}

export function AssessmentResults({ assignments, fitScores }: { assignments: Assignment[]; fitScores: FitScore[] }) {
  const { t } = useI18n();
  const latestFit = fitScores[0];
  const breakdown = latestFit?.breakdown as Record<string, number> | null;
  const hasDisc =
    breakdown && (breakdown.dominance || breakdown.influence || breakdown.steadiness || breakdown.compliance);

  // Group assignments by code for special rendering
  const byCode = new Map<string, Assignment>();
  for (const a of assignments) {
    byCode.set(a.assessmentType.code.toLowerCase(), a);
  }

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.assessmentResults}</h3>

      {/* DISC Chart */}
      {hasDisc && (
        <div className="bg-[#F6F6F6] rounded-lg p-4 mb-4">
          <DiscChart scores={breakdown} />
        </div>
      )}

      <div className="space-y-2">
        {/* PCA / DISC with score boxes */}
        {hasDisc && (
          <>
            <AssessmentRow name="PCA (DISC)" status="completed">
              <div className="mt-2">
                <DiscScoreBoxes breakdown={breakdown} />
              </div>
            </AssessmentRow>
          </>
        )}

        {/* All other assignments */}
        {assignments.map((a) => {
          // Skip PCA if already rendered via DISC
          if (hasDisc && a.assessmentType.code.toLowerCase() === 'pca') return null;

          return (
            <AssessmentRow key={a.id} name={a.assessmentType.name} status={a.status}>
              {a.result?.normalizedScore != null && (
                <div className="mt-1">
                  <div className="w-full bg-[#F6F6F6] rounded-full h-2">
                    <div
                      className="bg-[#1F114C] h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(a.result.normalizedScore, 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#585858] mt-1">
                    {t.candidates.level}{' '}
                    <span className="font-medium text-[#1F114C]">{a.result.normalizedScore}/100</span>
                  </p>
                </div>
              )}
              {a.result?.band != null && (
                <p className="text-[11px] font-medium text-[#1F114C] mt-1">
                  {t.assessmentPlayer.bandLabels[a.result.band]}
                  {a.result?.normSampleSize != null && (
                    <span className="font-normal text-[#8B8B8B]">
                      {' '}
                      {t.assessmentPlayer.resultSampleSizeLabel.replace(
                        '{sampleSize}',
                        String(a.result.normSampleSize),
                      )}
                    </span>
                  )}
                </p>
              )}
              {a.result?.breakdown != null &&
              typeof a.result.breakdown === 'object' &&
              !Array.isArray(a.result.breakdown) ? (
                <BreakdownGrid data={a.result.breakdown as Record<string, number>} />
              ) : null}
            </AssessmentRow>
          );
        })}

        {/* View Full Reports button */}
        <button className="w-full mt-3 bg-[#F6F6F6] text-[#1F114C] text-[12px] font-medium py-2 rounded-lg hover:bg-[#EDEDED] transition">
          {t.candidates.viewFullReports}
        </button>
      </div>
    </div>
  );
}
