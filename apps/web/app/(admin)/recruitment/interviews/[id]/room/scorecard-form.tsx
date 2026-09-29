'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import { Skeleton } from '../../../../../../components';
import type { InterviewDetail } from '../../../../../../lib/trpc-types';
import { StarRating } from './star-rating';
import { RecommendationPicker } from './recommendation-picker';
import { EvaluatorComparison } from './evaluator-comparison';
import {
  OVERALL_NOTES_MAX,
  buildSubmission,
  parseRecommendation,
  parseStoredRatings,
  resolveCompetencies,
  withStoredCompetencies,
  type DefaultCompetencyId,
  type ScorecardCompetency,
  type ScorecardDraft,
} from './scorecard-model';

const DEFAULT_LABEL_KEYS = {
  leadership: 'defaultCompetencyLeadership',
  analytical: 'defaultCompetencyAnalytical',
  communication: 'defaultCompetencyCommunication',
  problem_solving: 'defaultCompetencyProblemSolving',
} as const satisfies Record<DefaultCompetencyId, string>;

interface ScorecardFormProps {
  interview: InterviewDetail;
  currentUserId: string | null;
}

/**
 * The evaluator's scorecard, persisted through the existing
 * `interview.submitScorecard` procedure and re-loaded via `interview.getScorecard`.
 */
export function ScorecardForm({ interview, currentUserId }: ScorecardFormProps) {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const jobProfile = trpc.vacancy.getJobProfile.useQuery({ vacancyId: interview.vacancy.id }, { retry: false });
  const existing = trpc.interview.getScorecard.useQuery({ interviewId: interview.id });
  const [draft, setDraft] = useState<ScorecardDraft>({ ratings: {}, recommendation: null, overallNotes: '' });

  const stored = useMemo(() => parseStoredRatings(existing.data?.ratings), [existing.data]);
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    const card = existing.data;
    if (!card || hydratedFor.current === card.id) return;
    hydratedFor.current = card.id;
    setDraft({
      ratings: parseStoredRatings(card.ratings),
      recommendation: parseRecommendation(card.recommendation),
      overallNotes: card.overallNotes ?? '',
    });
  }, [existing.data]);

  const resolved = useMemo(
    () => resolveCompetencies(jobProfile.isError ? null : jobProfile.data?.competencies),
    [jobProfile.isError, jobProfile.data],
  );
  const competencies = useMemo(() => withStoredCompetencies(resolved.items, stored), [resolved.items, stored]);

  const submit = trpc.interview.submitScorecard.useMutation({
    onSuccess: (saved) => {
      // The draft already IS what was just saved: mark it hydrated so the refetch
      // triggered below cannot overwrite edits the evaluator makes meanwhile.
      hydratedFor.current = saved.id;
      toast(t.interviewRoom.submitSuccess, { type: 'success' });
      void utils.interview.getScorecard.invalidate({ interviewId: interview.id });
      void utils.interview.getById.invalidate({ id: interview.id });
      void utils.interview.getPendingScorecards.invalidate();
    },
    onError: (err) => {
      toast(err.data?.code === 'FORBIDDEN' ? t.interviewRoom.submitForbidden : t.interviewRoom.submitError, {
        type: 'error',
      });
    },
  });

  if (jobProfile.isLoading || existing.isLoading) {
    return (
      <div className="p-4 space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (existing.isError) {
    return (
      <div role="alert" className="p-4 text-center">
        <p className="text-[12px] text-[#585858] mb-3">{t.interviewRoom.loadError}</p>
        <button
          type="button"
          onClick={() => void existing.refetch()}
          className="text-[12px] font-medium text-[#1F114C] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C] rounded"
        >
          {t.interviewRoom.retry}
        </button>
      </div>
    );
  }

  const labelFor = (c: ScorecardCompetency) =>
    c.label ?? t.interviewRoom[DEFAULT_LABEL_KEYS[c.key as DefaultCompetencyId]] ?? c.key;
  const sourceNote = jobProfile.isError
    ? t.interviewRoom.competenciesSourceUnavailable
    : resolved.source === 'vacancy'
      ? t.interviewRoom.competenciesSourceVacancy
      : t.interviewRoom.competenciesSourceDefault;

  const isEvaluator = currentUserId !== null && interview.evaluators.some((e) => e.userId === currentUserId);
  const submission = buildSubmission(competencies, draft);
  const canSubmit = isEvaluator && submission !== null && !submit.isPending;
  const ratedCount = competencies.filter((c) => draft.ratings[c.key] !== undefined).length;
  const submittedAt = existing.data?.submittedAt ?? null;
  const hint =
    currentUserId !== null && !isEvaluator
      ? t.interviewRoom.notEvaluator
      : submission === null
        ? t.interviewRoom.hintIncomplete
        : null;

  const handleSubmit = () => {
    if (!canSubmit || !submission) return;
    submit.mutate({ interviewId: interview.id, ...submission });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        <h3 className="text-[13px] font-semibold text-[#1F114C] mb-1">{t.interviews.competencyEvaluation}</h3>
        <p className="text-[10px] text-[#8B8B8B] mb-3" data-testid="competency-source">
          {sourceNote}
        </p>

        {competencies.map((c) => {
          const label = labelFor(c);
          const rated = draft.ratings[c.key] !== undefined;
          return (
            <div
              key={c.key}
              className={`mb-3 rounded-lg p-3 border flex items-center justify-between gap-2 ${rated ? 'bg-[#F9FAFB] border-[#F0F0F0]' : 'bg-white border-[#EDEDED]'}`}
            >
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#333] break-words">{label}</p>
                {c.targetLevel !== null && (
                  <p className="text-[10px] text-[#8B8B8B]">
                    {t.interviewRoom.targetLevel.replace('{n}', String(c.targetLevel))}
                  </p>
                )}
              </div>
              <StarRating
                label={label}
                value={draft.ratings[c.key] ?? 0}
                disabled={submit.isPending}
                onChange={(v) => setDraft((prev) => ({ ...prev, ratings: { ...prev.ratings, [c.key]: v } }))}
              />
            </div>
          );
        })}

        <RecommendationPicker
          value={draft.recommendation}
          disabled={submit.isPending}
          onChange={(rec) => setDraft((prev) => ({ ...prev, recommendation: rec }))}
        />

        <label className="block mb-4">
          <span className="block text-[12px] font-medium text-[#333] mb-2">{t.interviewRoom.overallNotesLabel}</span>
          <textarea
            value={draft.overallNotes}
            onChange={(e) => setDraft((prev) => ({ ...prev, overallNotes: e.target.value }))}
            placeholder={t.interviewRoom.overallNotesPlaceholder}
            maxLength={OVERALL_NOTES_MAX}
            disabled={submit.isPending}
            className="w-full bg-[#F6F6F6] rounded border border-[#EDEDED] p-2 text-[11px] h-24 resize-none placeholder:text-[#8B8B8B] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C]"
          />
          <span className="block text-[10px] text-[#8B8B8B] mt-1">
            {t.interviewRoom.notesCount
              .replace('{n}', String(draft.overallNotes.length))
              .replace('{max}', String(OVERALL_NOTES_MAX))}
          </span>
        </label>

        <EvaluatorComparison
          evaluators={interview.evaluators}
          scorecards={interview.scorecards}
          currentUserId={currentUserId}
          revealScores={submittedAt !== null}
        />
      </div>

      <div className="p-4 border-t border-[#EDEDED] shrink-0">
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-[11px] text-[#8B8B8B]">
            {t.interviewRoom.progress
              .replace('{rated}', String(ratedCount))
              .replace('{total}', String(competencies.length))}
          </span>
          <progress
            value={ratedCount}
            max={competencies.length}
            aria-hidden="true"
            className="w-32 h-1.5 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-[#EDEDED] [&::-webkit-progress-value]:bg-[#DD0C15] [&::-moz-progress-bar]:bg-[#DD0C15]"
          />
        </div>
        {submittedAt && !submit.isPending && (
          <p className="text-[11px] text-emerald-700 mb-2" role="status">
            {t.interviewRoom.submittedAt.replace(
              '{date}',
              new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(submittedAt)),
            )}
          </p>
        )}
        {submit.isError && (
          <p className="text-[11px] text-red-600 mb-2" role="alert">
            {submit.error.data?.code === 'FORBIDDEN' ? t.interviewRoom.submitForbidden : t.interviewRoom.submitError}
          </p>
        )}
        {hint && <p className="text-[11px] text-[#8B8B8B] mb-2">{hint}</p>}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full bg-[#DD0C15] text-white py-2.5 rounded-lg text-[13px] font-medium shadow-[0_2px_8px_rgba(221,12,21,0.25)] hover:bg-[#c00b13] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submit.isPending
            ? t.interviewRoom.submitting
            : submittedAt
              ? t.interviewRoom.update
              : t.interviewRoom.submit}
        </button>
      </div>
    </div>
  );
}
