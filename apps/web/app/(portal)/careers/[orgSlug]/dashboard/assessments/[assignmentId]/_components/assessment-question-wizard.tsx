'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '../../../../../../../../lib/trpc';
import { useI18n } from '../../../../../../../../lib/i18n';
import { formatMessage } from '../../../../../../../../lib/i18n/format';
import { Button, ErrorState, ProgressBar, Skeleton } from '../../../../../../../../components';
import { AssessmentTimer } from './assessment-timer';
import { AssessmentQuestionCard, type QuestionCardAnswer, type QuestionCardOption } from './assessment-question-card';
import { AssessmentSubmitConfirm } from './assessment-submit-confirm';
import { mapAssessmentErrorMessage } from './assessment-error-messages';
import { readDraft, writeDraft, clearDraft } from '../_lib/assessment-draft-storage';
import { useAssessmentCountdown } from '../_lib/use-assessment-countdown';

interface AssessmentQuestionWizardProps {
  orgSlug: string;
  assignmentId: string;
  startedAt: Date;
  expiresAt: Date | null;
  durationMinutes: number | null;
  onSubmitted: () => void;
}

export function AssessmentQuestionWizard({
  orgSlug,
  assignmentId,
  startedAt,
  expiresAt,
  durationMinutes,
  onSubmitted,
}: AssessmentQuestionWizardProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const questionsQuery = trpc.candidatePortal.getAssessmentQuestions.useQuery({ orgSlug, assignmentId });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuestionCardAnswer>>(
    () => readDraft(assignmentId)?.answers ?? {},
  );
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const promptRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const movedRef = useRef(false);

  // After Next/Back (not on first render) the new question's prompt takes focus, so it is read next
  // (accessibility.md › Mobility); the progress line below is a polite live region.
  useEffect(() => {
    if (!movedRef.current) return;
    promptRef.current?.focus();
  }, [currentIndex]);
  // A failed submit closes the dialog: focus goes to the error, so it is announced and the next Tab reaches the
  // submit button again (feedback.md › Best practices).
  useEffect(() => {
    if (errorMessage) errorRef.current?.focus();
  }, [errorMessage]);
  const goTo = (index: number) => {
    movedRef.current = true;
    setCurrentIndex(index);
  };

  const submitMutation = trpc.candidatePortal.submitAssessment.useMutation({
    onSuccess: () => {
      clearDraft(assignmentId);
      onSubmitted();
    },
    onError: (error: { message: string }) => {
      if (error.message === 'assignment_already_completed') {
        utils.candidatePortal.getMyAssessments.invalidate();
        onSubmitted();
        return;
      }
      setShowConfirm(false);
      setErrorMessage(mapAssessmentErrorMessage(error.message, t.assessmentPlayer));
    },
  });

  // Filters out any stale draft answer for a question no longer present in the
  // fetched set (e.g. deactivated between draft-write and submit) — otherwise the
  // backend's question_not_in_assessment check rejects the submission, and since
  // the draft persists with no clear-draft affordance, the candidate would be
  // permanently stuck resubmitting the same rejected payload.
  const buildSubmission = useCallback(() => {
    const validQuestionIds = new Set((questionsQuery.data ?? []).map((q) => q.id));
    return Object.entries(answers)
      .filter(([questionId]) => validQuestionIds.has(questionId))
      .map(([questionId, a]) => ({
        questionId,
        selectedOptionIds: a.selectedOptionIds,
        freeText: a.freeText,
      }));
  }, [answers, questionsQuery.data]);

  const doSubmit = useCallback(() => {
    submitMutation.mutate({ orgSlug, assignmentId, answers: buildSubmission() });
  }, [orgSlug, assignmentId, buildSubmission, submitMutation]);

  // Fires doSubmit at 0:00 with whatever's answered so far — no confirmation step
  // on timer expiry, per the Slice 3 design ("no time's-up-please-hurry limbo state").
  const remainingSeconds = useAssessmentCountdown({ startedAt, expiresAt, durationMinutes, onExpire: doSubmit });

  const handleAnswerChange = (questionId: string, answer: QuestionCardAnswer) => {
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    writeDraft(assignmentId, next);
  };

  if (questionsQuery.isLoading) {
    return (
      <div aria-busy="true" className="mx-auto max-w-2xl space-y-3 p-4">
        <span className="sr-only">{t.assessmentPlayer.loading}</span>
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (questionsQuery.isError || !questionsQuery.data) {
    return <ErrorState title={t.assessmentPlayer.loadError} onRetry={() => void questionsQuery.refetch()} />;
  }

  // getAssessmentQuestions.useQuery's `options` field arrives typed as
  // Prisma.JsonValue (the raw JSON column) — narrow it to the shape the
  // question card actually renders, same cast pattern as the staff-side
  // authoring page (recruitment/assessments/page.tsx).
  const questions = questionsQuery.data.map((q) => ({
    ...q,
    options: (q.options as unknown as QuestionCardOption[]) ?? [],
  }));

  // An assessment type with no active questions (not-yet-authored, or fully
  // deactivated after assignment) has nothing to render — bail out with the
  // generic load-error message rather than crashing on questions[0].id below.
  if (questions.length === 0) {
    return <ErrorState title={t.assessmentPlayer.loadError} />;
  }

  const total = questions.length;
  const question = questions[currentIndex];
  const isLast = currentIndex === total - 1;
  const unansweredOrders = questions
    .filter((q) => {
      const a = answers[q.id];
      const hasChoice = Array.isArray(a?.selectedOptionIds) && a.selectedOptionIds.length > 0;
      const hasText = typeof a?.freeText === 'string' && a.freeText.length > 0;
      return !hasChoice && !hasText;
    })
    .map((q) => q.order + 1);

  return (
    <div className="min-h-dvh bg-surface p-4">
      <div className="mx-auto max-w-2xl space-y-5 rounded-2xl bg-white p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-callout font-medium text-secondary tabular-nums">
            {formatMessage(t.assessmentPlayer.questionProgress, { current: currentIndex + 1, total })}
          </p>
          {remainingSeconds !== null && <AssessmentTimer remainingSeconds={remainingSeconds} />}
        </div>
        <ProgressBar
          value={currentIndex + 1}
          max={total}
          label={formatMessage(t.assessmentPlayer.questionProgress, { current: currentIndex + 1, total })}
          hideLabel
        />

        {errorMessage && (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-1 text-callout text-danger outline-none"
          >
            <svg
              className="mt-px size-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
            </svg>
            <span>{errorMessage}</span>
          </p>
        )}

        <AssessmentQuestionCard
          ref={promptRef}
          question={question}
          answer={answers[question.id]}
          onChange={(a) => handleAnswerChange(question.id, a)}
        />

        <div className="flex gap-3 pt-2">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            disabled={currentIndex === 0}
            onClick={() => goTo(currentIndex - 1)}
          >
            {t.assessmentPlayer.wizardBack}
          </Button>
          {isLast ? (
            <Button size="lg" className="flex-1" onClick={() => setShowConfirm(true)}>
              {t.assessmentPlayer.wizardReviewSubmit}
            </Button>
          ) : (
            <Button size="lg" className="flex-1" onClick={() => goTo(currentIndex + 1)}>
              {t.assessmentPlayer.wizardNext}
            </Button>
          )}
        </div>
      </div>

      {showConfirm && (
        <AssessmentSubmitConfirm
          unansweredOrders={unansweredOrders}
          isSubmitting={submitMutation.isPending}
          onConfirm={doSubmit}
          onCancel={() => setShowConfirm(false)}
          onJumpTo={(order) => {
            const index = questions.findIndex((q) => q.order + 1 === order);
            setShowConfirm(false);
            if (index !== -1) goTo(index);
          }}
        />
      )}
    </div>
  );
}
