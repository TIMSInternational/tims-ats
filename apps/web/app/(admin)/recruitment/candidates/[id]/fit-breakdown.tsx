'use client';

import { useI18n } from '../../../../../lib/i18n';
import { AiSuggestionNotice } from '../../../../../components/ai-suggestion-notice';
import { fitBand, type FitBand } from '../../../../../lib/pipeline-fit';
import { isReviewPending } from '../../../../../lib/platform-api/fit-engine';
import { fitV2Entries } from '../../../../../lib/fit-v2-breakdown';
import { FitReviewPendingBadge } from '../../fit-review-pending-badge';
import { FitInstruments } from './fit-instruments';

// The same FIT scale as the header, the pipeline and the filter (A-23).
const FIT_BAR: Record<FitBand, string> = { high: 'bg-green-500', medium: 'bg-amber-500', low: 'bg-red-500' };

interface FitScore {
  id: string;
  overallScore: number;
  breakdown: unknown;
  calculatedAt: Date | string;
}

interface FitBreakdownShape {
  assessment: number | null;
  interview: number | null;
  experience: number | null;
  education: number | null;
  languages: number | null;
}

function ProgressBar({ score }: { score: number }) {
  const barColor = FIT_BAR[fitBand(score)];
  return (
    <div className="w-full bg-[#F6F6F6] rounded-full h-2">
      <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${Math.min(score, 100)}%` }} />
    </div>
  );
}

export function FitBreakdown({ fitScores }: { fitScores: FitScore[] }) {
  const { t } = useI18n();
  const latestFit = fitScores[0];
  if (!latestFit) return null;

  const raw = latestFit.breakdown as Partial<FitBreakdownShape> | null;
  if (!raw) return null;
  // FIT v2: a provisional score is marked (a result it counts on awaits review), and an assessment dimension hidden
  // from this reader (owner default D6) says "below minimum" rather than "no data".
  const pending = isReviewPending(raw);
  const assessmentBelowMinimum = raw.assessment == null && fitV2Entries(raw).some((e) => e.belowMinimum && e.instrument !== 'english');

  const dimensions: Array<{ key: keyof FitBreakdownShape; label: string }> = [
    { key: 'assessment', label: t.candidates.fitDimensionAssessment },
    { key: 'interview', label: t.candidates.fitDimensionInterview },
    { key: 'experience', label: t.candidates.fitDimensionExperience },
    { key: 'education', label: t.candidates.fitDimensionEducation },
    { key: 'languages', label: t.candidates.fitDimensionLanguages },
  ];

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-1">{t.candidates.fitBreakdown}</h3>
      <AiSuggestionNotice className="mb-3" />
      {pending && (
        <div className="mb-3">
          <FitReviewPendingBadge />
        </div>
      )}
      <div className="space-y-2">
        {dimensions.map((dim) => {
          const score = raw[dim.key];
          return (
            <div key={dim.key}>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-[#585858]">{dim.label}</span>
                <span className="text-[#1F114C] font-medium">
                  {typeof score === 'number'
                    ? `${score}/100`
                    : dim.key === 'assessment' && assessmentBelowMinimum
                      ? t.candidates.fitInstrumentBelowMinimum
                      : t.candidates.fitDimensionUnavailable}
                </span>
              </div>
              <ProgressBar score={typeof score === 'number' ? score : 0} />
            </div>
          );
        })}
      </div>
      <FitInstruments breakdown={raw} />
    </div>
  );
}
