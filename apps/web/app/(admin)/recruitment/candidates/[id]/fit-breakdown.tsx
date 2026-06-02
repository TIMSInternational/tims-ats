'use client';

import { useI18n } from '../../../../../lib/i18n';

interface FitScore {
  id: string;
  overallScore: number;
  breakdown: unknown;
  calculatedAt: Date | string;
}

interface BreakdownDimension {
  label: string;
  score: number;
}

function ProgressBar({ score }: { score: number }) {
  const barColor = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="w-full bg-[#F6F6F6] rounded-full h-2">
      <div
        className={`${barColor} h-2 rounded-full transition-all`}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    </div>
  );
}

export function FitBreakdown({ fitScores }: { fitScores: FitScore[] }) {
  const { t } = useI18n();
  const latestFit = fitScores[0];
  if (!latestFit) return null;

  const raw = latestFit.breakdown as Record<string, number> | null;

  // Map breakdown keys to i18n labels, or use defaults
  const dimensions: BreakdownDimension[] = raw
    ? Object.entries(raw).map(([key, score]) => {
        const labelMap: Record<string, string> = {
          cognitive: t.candidates.cognitive,
          personality: t.candidates.personality,
          experience: t.candidates.experience,
          education: t.candidates.educationLabel,
          interview: t.candidates.interviewLabel,
          dominance: 'Dominancia',
          influence: 'Influencia',
          steadiness: 'Solidez',
          compliance: 'Control',
        };
        return { label: labelMap[key] ?? key, score: typeof score === 'number' ? score : 0 };
      })
    : [];

  if (dimensions.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.candidates.fitBreakdown}</h3>
      <div className="space-y-2">
        {dimensions.map((dim) => (
          <div key={dim.label}>
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-[#585858]">{dim.label}</span>
              <span className="text-[#1F114C] font-medium">{dim.score}/100</span>
            </div>
            <ProgressBar score={dim.score} />
          </div>
        ))}
      </div>
    </div>
  );
}
