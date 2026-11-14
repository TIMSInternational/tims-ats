'use client';

import { useI18n } from '../../../../../lib/i18n';
import { ProgressBar } from '../../../../../components';
import { AiSuggestionNotice } from '../../../../../components/ai-suggestion-notice';
import { fitBand, type FitBand } from '../../../../../lib/pipeline-fit';
import { isReviewPending } from '../../../../../lib/platform-api/fit-engine';
import { fitV2Entries } from '../../../../../lib/fit-v2-breakdown';
import { FitReviewPendingBadge } from '../../fit-review-pending-badge';
import { FitInstruments } from './fit-instruments';

// The same FIT scale as the header, the pipeline and the filter (A-23).
const FIT_TONE: Record<FitBand, 'success' | 'warning' | 'danger'> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
};

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

export function FitBreakdown({ fitScores }: { fitScores: FitScore[] }) {
  const { t } = useI18n();
  const latestFit = fitScores[0];
  if (!latestFit) return null;

  const raw = latestFit.breakdown as Partial<FitBreakdownShape> | null;
  if (!raw) return null;
  // FIT v2: a provisional score is marked (a result it counts on awaits review), and an assessment dimension hidden
  // from this reader (owner default D6) says "below minimum" rather than "no data".
  const pending = isReviewPending(raw);
  const assessmentBelowMinimum =
    raw.assessment == null && fitV2Entries(raw).some((e) => e.belowMinimum && e.instrument !== 'english');

  const dimensions: Array<{ key: keyof FitBreakdownShape; label: string }> = [
    { key: 'assessment', label: t.candidates.fitDimensionAssessment },
    { key: 'interview', label: t.candidates.fitDimensionInterview },
    { key: 'experience', label: t.candidates.fitDimensionExperience },
    { key: 'education', label: t.candidates.fitDimensionEducation },
    { key: 'languages', label: t.candidates.fitDimensionLanguages },
  ];

  return (
    <div className="rounded-xl bg-white p-4 shadow-card md:p-5">
      <h3 className="mb-1 text-subheading font-semibold text-brand">{t.candidates.fitBreakdown}</h3>
      <p className="mb-2 text-callout text-secondary">{t.candidates.fitDroppedNote}</p>
      <AiSuggestionNotice className="mb-3" />
      {pending && (
        <div className="mb-3">
          <FitReviewPendingBadge />
        </div>
      )}
      <div className="space-y-2">
        {dimensions.map((dim) => {
          const score = raw[dim.key];
          const scored = typeof score === 'number';
          const valueText = scored
            ? `${score}/100`
            : dim.key === 'assessment' && assessmentBelowMinimum
              ? t.candidates.fitInstrumentBelowMinimum
              : t.candidates.fitDimensionUnavailable;
          return (
            <div key={dim.key}>
              <div className="mb-1 flex justify-between gap-2 text-callout">
                <span className="text-secondary">{dim.label}</span>
                <span className={scored ? 'font-medium tabular-nums text-brand' : 'text-secondary'}>{valueText}</span>
              </div>
              {/* No data is a dashed empty track, never a 0% bar (charting-data.md › Best practices). */}
              <ProgressBar
                kind="meter"
                label={dim.label}
                hideLabel
                value={scored ? Math.min(score, 100) : 0}
                valueText={valueText}
                noData={!scored}
                tone={scored ? FIT_TONE[fitBand(score)] : 'brand'}
              />
            </div>
          );
        })}
      </div>
      <FitInstruments breakdown={raw} />
    </div>
  );
}
