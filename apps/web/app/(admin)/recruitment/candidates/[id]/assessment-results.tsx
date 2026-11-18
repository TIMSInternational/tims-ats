'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatMessage } from '../../../../../lib/i18n/format';
import { DiscChart, ProgressBar, StatusBadge, type StatusTone } from '../../../../../components';
import { EssayGradingPanel } from './essay-grading-panel';
import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import { assignmentsAwaitingReview } from '../../../../../lib/fit-v2-breakdown';

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

const STATUS_TONE: Record<string, StatusTone> = { completed: 'success', in_progress: 'info' };

// An assignment's status as a word, never the raw status code (accessibility.md › Vision).
function StatusLabel({ status }: { status: string }) {
  const { t } = useI18n();
  const labels = t.candidates.assessmentStatus as Record<string, string>;
  return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{labels[status] ?? labels.assigned}</StatusBadge>;
}

// Breakdown keys are data names ("dominance"); show the DISC factor names where they exist, else a readable form.
function useBreakdownLabel() {
  const { t } = useI18n();
  const f = t.providerAssessments.results.pca.factors;
  const known: Record<string, string> = { dominance: f.d, influence: f.i, steadiness: f.s, compliance: f.c };
  return (key: string) => known[key] ?? key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
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
        <div key={d.key} className="flex-1 rounded bg-surface p-2 text-center">
          <p className="text-caption text-secondary">{d.key}</p>
          <p className="text-subheading font-bold text-brand tabular-nums">{d.value}</p>
        </div>
      ))}
    </div>
  );
}

function BreakdownGrid({ data }: { data: Record<string, number> }) {
  const labelOf = useBreakdownLabel();
  const entries = Object.entries(data).slice(0, 6);
  return (
    <div className="grid grid-cols-3 gap-2 mt-2">
      {entries.map(([key, val]) => (
        <div key={key} className="rounded bg-surface p-2 text-center">
          <p className="text-caption text-secondary">{labelOf(key)}</p>
          <p className="text-body font-bold text-brand tabular-nums">{String(val)}</p>
        </div>
      ))}
    </div>
  );
}

function AssessmentRow({ name, status, children }: { name: string; status: string; children?: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body text-primary">{name}</span>
        <StatusLabel status={status} />
      </div>
      {children}
    </div>
  );
}

export function AssessmentResults({ assignments, fitScores }: { assignments: Assignment[]; fitScores: FitScore[] }) {
  const { t } = useI18n();
  // FIT v2 / D5: the essay grading panel (and its queries) mounts only with the flag on; flag off renders as before.
  const essayGrading = isFitEngineV2Enabled();
  // FIT v2: an assignment a stored score holds as "needs review" (cancelled, flagged, an essay awaiting a grade) is
  // marked, so its number here is not read as final.
  const underReview = assignmentsAwaitingReview(fitScores);
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
    <div className="rounded-xl bg-white p-4 shadow-card md:p-5">
      <h3 className="mb-4 text-subheading font-semibold text-brand">{t.candidates.assessmentResults}</h3>

      {/* DISC Chart */}
      {hasDisc && (
        <div className="mb-4 rounded-lg bg-surface p-4">
          <DiscChart scores={breakdown} />
        </div>
      )}

      <div className="space-y-2">
        {/* PCA / DISC with score boxes */}
        {hasDisc && (
          <>
            <AssessmentRow name={t.candidates.pcaDiscRow} status="completed">
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
              {underReview.has(a.id) && (
                <p data-testid="assessment-review-pending" className="mt-1 text-callout text-warning">
                  {t.candidates.assessmentReviewPending}
                </p>
              )}
              {a.result?.normalizedScore === null && a.status === 'completed' && (
                <p className="mt-1 text-callout text-warning">{t.candidates.assessmentScorePending}</p>
              )}
              {a.result?.normalizedScore != null && (
                <div className="mt-1">
                  <ProgressBar
                    kind="meter"
                    value={Math.min(a.result.normalizedScore, 100)}
                    max={100}
                    label={a.assessmentType.name}
                    hideLabel
                    valueText={formatMessage(t.candidates.levelValue, { value: a.result.normalizedScore })}
                  />
                  <p className="mt-1 text-callout text-secondary">
                    {t.candidates.level}{' '}
                    <span className="font-medium text-brand tabular-nums">{a.result.normalizedScore}/100</span>
                  </p>
                </div>
              )}
              {a.result?.band != null && (
                <p className="mt-1 text-callout font-medium text-brand">
                  {t.assessmentPlayer.bandLabels[a.result.band]}
                  {a.result?.normSampleSize != null && (
                    <span className="font-normal text-secondary">
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
              {essayGrading && a.status === 'completed' && a.result != null && (
                <EssayGradingPanel assignmentId={a.id} />
              )}
            </AssessmentRow>
          );
        })}
      </div>
    </div>
  );
}
