'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import { Skeleton } from '../../../../../../components';
import { Button } from '../../../../../../components/button';
import { textareaClasses } from '../../../../../../components/field-styles';
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

// Navy while rating, green once every competency is rated (red is reserved for destructive actions).
const PROGRESS_TODO = '[&::-webkit-progress-value]:bg-brand [&::-moz-progress-bar]:bg-brand';
const PROGRESS_DONE = '[&::-webkit-progress-value]:bg-success [&::-moz-progress-bar]:bg-success';

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

  // The competencies come WITH the interview (interview.getById, interview:read) instead of a separate
  // vacancy.getJobProfile call (vacancy:read): a committee panelist has no vacancy:read and used to see
  // "could not load the competencies" (F-10). They are the same set submitScorecard requires.
  const resolved = useMemo(() => resolveCompetencies(interview.scorecardCompetencies), [interview.scorecardCompetencies]);
  const competencies = useMemo(() => withStoredCompetencies(resolved.items, stored), [resolved.items, stored]);

  // BAD_REQUEST = the server's completeness check refused the card (e.g. the job profile
  // changed while the room was open); FORBIDDEN = not an assigned evaluator; CONFLICT = the interview
  // was rescheduled while the card was being filled in (it is not filed against the new appointment).
  const submitErrorMessage = (code: string | undefined) =>
    code === 'FORBIDDEN'
      ? t.interviewRoom.submitForbidden
      : code === 'BAD_REQUEST'
        ? t.interviewRoom.submitIncomplete
        : code === 'CONFLICT'
          ? t.interviewRoom.submitRescheduled
          : t.interviewRoom.submitError;

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
      toast(submitErrorMessage(err.data?.code), { type: 'error' });
      // Show the new schedule after a reschedule refused the card.
      if (err.data?.code === 'CONFLICT') void utils.interview.getById.invalidate({ id: interview.id });
    },
  });

  if (existing.isLoading) {
    return (
      <div className="p-4 space-y-3" aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (existing.isError) {
    return (
      <div role="alert" className="p-4 text-center">
        <p className="text-callout text-secondary mb-3">{t.interviewRoom.loadError}</p>
        <Button variant="secondary" size="sm" onClick={() => void existing.refetch()}>
          {t.interviewRoom.retry}
        </Button>
      </div>
    );
  }

  const labelFor = (c: ScorecardCompetency) =>
    c.label ?? t.interviewRoom[DEFAULT_LABEL_KEYS[c.key as DefaultCompetencyId]] ?? c.key;
  const sourceNote =
    resolved.source === 'vacancy' ? t.interviewRoom.competenciesSourceVacancy : t.interviewRoom.competenciesSourceDefault;

  const isEvaluator = currentUserId !== null && interview.evaluators.some((e) => e.userId === currentUserId);
  const submission = buildSubmission(competencies, draft);
  const canSubmit = isEvaluator && submission !== null && !submit.isPending;
  const ratedCount = competencies.filter((c) => draft.ratings[c.key] !== undefined).length;
  const submittedAt = existing.data?.submittedAt ?? null;
  // A viewer who is not an assigned evaluator sees the reason FIRST and a read-only form, instead of
  // filling in a card that can never be saved (feedback.md › Best practices).
  const isReadOnly = currentUserId !== null && !isEvaluator;
  const hint = !isReadOnly && submission === null ? t.interviewRoom.hintIncomplete : null;
  const isComplete = competencies.length > 0 && ratedCount === competencies.length;

  const handleSubmit = () => {
    if (!canSubmit || !submission) return;
    // The appointment this form was filled in for: the server refuses the card if it has since moved.
    submit.mutate({ interviewId: interview.id, ...submission, expectedScheduledAt: new Date(interview.scheduledAt) });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {isReadOnly && (
          <p role="note" className="mb-4 flex items-start gap-2 rounded-lg bg-info-bg p-3 text-callout text-info">
            <svg className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            {t.interviewRoom.notEvaluator}
          </p>
        )}
        <h3 className="text-subheading font-semibold text-brand mb-1">{t.interviews.competencyEvaluation}</h3>
        <p className="text-callout text-secondary mb-3" data-testid="competency-source">
          {sourceNote}
        </p>

        {competencies.map((c) => {
          const label = labelFor(c);
          const rated = draft.ratings[c.key] !== undefined;
          return (
            <div
              key={c.key}
              className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${rated ? 'border-border bg-surface-hover' : 'border-border bg-white'}`}
            >
              <div className="min-w-0">
                <p className="text-callout font-medium text-primary break-words">{label}</p>
                {c.description && <p className="text-caption text-secondary break-words">{c.description}</p>}
                {c.targetLevel !== null && (
                  <p className="text-caption text-muted">
                    {t.interviewRoom.targetLevel
                      .replace('{n}', String(c.targetLevel))
                      .replace('{max}', String(c.targetScaleMax))}
                  </p>
                )}
              </div>
              <StarRating
                label={label}
                value={draft.ratings[c.key] ?? 0}
                disabled={submit.isPending || isReadOnly}
                onChange={(v) => setDraft((prev) => ({ ...prev, ratings: { ...prev.ratings, [c.key]: v } }))}
              />
            </div>
          );
        })}

        <RecommendationPicker
          value={draft.recommendation}
          disabled={submit.isPending || isReadOnly}
          onChange={(rec) => setDraft((prev) => ({ ...prev, recommendation: rec }))}
        />

        <label className="block mb-4">
          <span className="block text-body font-medium text-primary mb-1.5">{t.interviewRoom.overallNotesLabel}</span>
          <textarea
            value={draft.overallNotes}
            onChange={(e) => setDraft((prev) => ({ ...prev, overallNotes: e.target.value }))}
            placeholder={t.interviewRoom.overallNotesPlaceholder}
            maxLength={OVERALL_NOTES_MAX}
            disabled={submit.isPending || isReadOnly}
            className={textareaClasses('resize-none')}
          />
          <span className="block text-caption text-muted tabular-nums mt-1.5">
            {t.interviewRoom.notesCount
              .replace('{n}', String(draft.overallNotes.length))
              .replace('{max}', String(OVERALL_NOTES_MAX))}
          </span>
        </label>

        <EvaluatorComparison
          evaluators={interview.evaluators}
          scorecards={interview.scorecards}
          currentUserId={currentUserId}
          isViewerBlinded={isEvaluator && submittedAt === null}
          competencies={resolved.items}
          labelFor={labelFor}
        />
      </div>

      <div className="p-4 border-t border-border shrink-0">
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-callout text-secondary tabular-nums">
            {t.interviewRoom.progress
              .replace('{rated}', String(ratedCount))
              .replace('{total}', String(competencies.length))}
          </span>
          <progress
            value={ratedCount}
            max={competencies.length}
            aria-hidden="true"
            className={`w-32 h-1.5 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-border ${isComplete ? PROGRESS_DONE : PROGRESS_TODO}`}
          />
        </div>
        {submittedAt && !submit.isPending && (
          <p className="text-callout text-success mb-2" role="status">
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
          <p className="text-callout text-danger mb-2" role="alert">
            {submitErrorMessage(submit.error.data?.code)}
          </p>
        )}
        {hint && <p className="text-callout text-secondary mb-2">{hint}</p>}
        <Button fullWidth onClick={handleSubmit} disabled={!canSubmit}>
          {submit.isPending
            ? t.interviewRoom.submitting
            : submittedAt
              ? t.interviewRoom.update
              : t.interviewRoom.submit}
        </Button>
      </div>
    </div>
  );
}
