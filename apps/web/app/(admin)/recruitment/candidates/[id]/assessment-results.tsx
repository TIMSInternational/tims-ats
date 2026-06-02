'use client';

import { useI18n } from '../../../../../lib/i18n';
import { DiscChart, AssessmentBadge } from '../../../../../components';

interface Assignment {
  id: string;
  status: string;
  assignedAt: Date | string;
  completedAt: Date | string | null;
  assessmentType: { id: string; name: string; code: string };
  result: { id: string; rawScore: number | null; normalizedScore: number | null; breakdown: unknown } | null;
}

interface FitScore {
  id: string;
  overallScore: number;
  breakdown: unknown;
  calculatedAt: Date | string;
}

export function AssessmentResults({ assignments, fitScores }: { assignments: Assignment[]; fitScores: FitScore[] }) {
  const { t } = useI18n();
  const latestFit = fitScores[0];
  const breakdown = latestFit?.breakdown as Record<string, number> | null;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.assessmentResults}</h3>

      {/* DISC Chart if breakdown available */}
      {breakdown && (breakdown.dominance || breakdown.influence || breakdown.steadiness || breakdown.compliance) && (
        <div className="mb-4">
          <p className="text-[12px] text-[#585858] font-medium mb-2">{t.vacancies.pcaExpected}</p>
          <DiscChart scores={breakdown} />
        </div>
      )}

      {/* Assessment list */}
      <div className="space-y-2">
        {assignments.map((a) => (
          <div key={a.id} className="flex items-center justify-between py-2 border-b border-[#F6F6F6] last:border-0">
            <div className="flex items-center gap-2">
              <AssessmentBadge type={a.assessmentType.code} status={a.status} />
              <span className="text-[12px] text-[#333]">{a.assessmentType.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {a.result?.normalizedScore != null && (
                <span className="text-[13px] font-bold text-[#1F114C]">{a.result.normalizedScore}</span>
              )}
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                a.status === 'completed' ? 'bg-green-50 text-green-600' :
                a.status === 'in_progress' ? 'bg-amber-50 text-amber-600' :
                'bg-gray-100 text-gray-600'
              }`}>
                {a.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
