'use client';

import { useCallback, useState } from 'react';
import { trpc } from '../../../../../../../../lib/trpc';
import { useI18n } from '../../../../../../../../lib/i18n';
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
    return <p className="text-center text-[13px] text-[#8B8B8B] p-8">{t.assessmentPlayer.loading}</p>;
  }
  if (questionsQuery.isError || !questionsQuery.data) {
    return <p className="text-center text-[13px] text-[#B42318] p-8">{t.assessmentPlayer.loadError}</p>;
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
    return <p className="text-center text-[13px] text-[#B42318] p-8">{t.assessmentPlayer.loadError}</p>;
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
    <div className="min-h-screen bg-[#FAFAFA] p-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-lg p-6 space-y-5">
        <div className="flex items-center justify-between text-[12px] text-[#8B8B8B]">
          <span>
            {t.assessmentPlayer.questionLabel} {currentIndex + 1} {t.assessmentPlayer.ofLabel} {total}
          </span>
          {remainingSeconds !== null && (
            <span>
              {t.assessmentPlayer.timerLabel} {String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:
              {String(remainingSeconds % 60).padStart(2, '0')}
            </span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-[#EDEDED]">
          <div
            className="h-1.5 rounded-full bg-[#1F114C]"
            style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
          />
        </div>

        {errorMessage && <p className="text-[12px] text-[#B42318]">{errorMessage}</p>}

        <AssessmentQuestionCard
          question={question}
          answer={answers[question.id]}
          onChange={(a) => handleAnswerChange(question.id, a)}
        />

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => i - 1)}
            className="flex-1 h-10 rounded-xl border border-[#E5E5E5] text-[13px] font-medium text-[#585858] disabled:opacity-40"
          >
            {t.assessmentPlayer.wizardBack}
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="flex-1 h-10 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold"
            >
              {t.assessmentPlayer.wizardReviewSubmit}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => i + 1)}
              className="flex-1 h-10 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold"
            >
              {t.assessmentPlayer.wizardNext}
            </button>
          )}
        </div>
      </div>

      {showConfirm && (
        <AssessmentSubmitConfirm
          unansweredOrders={unansweredOrders}
          isSubmitting={submitMutation.isPending}
          onConfirm={doSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
