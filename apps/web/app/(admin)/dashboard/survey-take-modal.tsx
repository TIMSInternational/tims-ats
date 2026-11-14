'use client';

import { useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import {
  useEngagementSurveyForResponse,
  useEngagementSubmitSurveyResponse,
} from '../../../lib/platform-api/engagement';
import { Modal, Skeleton } from '../../../components';
import { Button } from '../../../components/button';
import { BUTTON_GROUP_CLASSES } from '../../../components/button-styles';
import { LoadError } from './load-error';
import { parseSurveyQuestions, type SurveyAnswer, type SurveyQuestion } from './survey-question';
import { SurveyQuestionField } from './survey-question-field';

interface SurveyTakeModalProps {
  surveyId: string;
  onClose: () => void;
}

// Take/answer modal for a single pending survey. Fetches the renderable survey
// definition (own-scoped getSurveyForResponse), renders one input per question
// by type, then submits answers keyed by question TEXT (the aggregator reads
// r.answers[q.text]) via submitSurveyResponse. A duplicate submission surfaces
// the backend CONFLICT as a friendly "already answered" toast.
export function SurveyTakeModal({ surveyId, onClose }: SurveyTakeModalProps) {
  const { t } = useI18n();
  const e = t.employeeHome;
  const queryClient = useQueryClient();

  const survey = useEngagementSurveyForResponse(surveyId);
  const questions: SurveyQuestion[] = useMemo(
    () => parseSurveyQuestions(survey.data?.questions),
    [survey.data?.questions],
  );

  const [answers, setAnswers] = useState<Record<string, SurveyAnswer>>({});

  const setAnswer = (text: string, value: SurveyAnswer) => setAnswers((prev) => ({ ...prev, [text]: value }));

  const submit = useEngagementSubmitSurveyResponse({
    onSuccess: () => {
      // myPendingSurveys is C#-only now (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP live, its TS
      // procedure deleted 2026-07-31) — invalidate its platform-api cache key directly instead of
      // the dead trpc.engagement.myPendingSurveys cache.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'engagement', 'my-pending-surveys'] });
      toast(e.surveySubmitSuccess, { type: 'success' });
      onClose();
    },
    // Byte-identical message on both stacks (DuplicateResponseMessage / 'Ya respondiste esta
    // encuesta') — matched by text, not the tRPC-specific error code, so it works on either path.
    onError: (err) => {
      toast(err.message === 'Ya respondiste esta encuesta' ? e.surveyAlreadyAnswered : err.message, { type: 'error' });
    },
  });

  // A required question is answered when it has a non-empty value.
  const requiredMet = questions.every((q) => {
    if (!q.required) return true;
    const v = answers[q.text];
    return typeof v === 'number' || (typeof v === 'string' && v.trim().length > 0);
  });

  const canSubmit = questions.length > 0 && requiredMet && !submit.isPending;

  const showFooter = !survey.isLoading && !survey.isError && questions.length > 0;
  const hintId = useId();

  const onSubmit = () => {
    if (!canSubmit) return;
    // answers map is keyed by question TEXT — matches the submit endpoint, which
    // is read back as r.answers[q.text] by the result aggregator.
    const payload: Record<string, SurveyAnswer> = {};
    for (const q of questions) {
      const v = answers[q.text];
      if (v !== undefined && !(typeof v === 'string' && v.trim().length === 0)) {
        payload[q.text] = v;
      }
    }
    submit.mutate({ surveyId, answers: payload });
  };

  // Cancel leading, the one primary (navy) trailing, in the Modal's sticky footer (foundation §9).
  const footer = showFooter ? (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {/* A neutral hint until the required answers exist, not a red error before anything was typed. */}
      {!requiredMet ? (
        <p id={hintId} className="text-callout text-secondary">
          {e.surveyRequiredHint}
        </p>
      ) : (
        <span />
      )}
      <div className={BUTTON_GROUP_CLASSES}>
        <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
          {t.common.cancel}
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!canSubmit}
          loading={submit.isPending}
          loadingLabel={e.surveySubmitting}
          aria-describedby={!requiredMet ? hintId : undefined}
        >
          {e.surveySubmit}
        </Button>
      </div>
    </div>
  ) : undefined;

  return (
    <Modal
      title={survey.data?.title ?? e.surveyTakeTitle}
      onClose={onClose}
      footer={footer}
      dirty={Object.keys(answers).length > 0 && !submit.isPending}
    >
      {survey.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : survey.isError ? (
        <LoadError message={e.surveyNotFound} onRetry={() => survey.refetch()} error={survey.error} />
      ) : questions.length === 0 ? (
        <p className="text-body text-secondary">{e.surveyNoQuestions}</p>
      ) : (
        <div className="space-y-5">
          {questions.map((q) => (
            <SurveyQuestionField
              key={q.text}
              question={q}
              value={answers[q.text]}
              disabled={submit.isPending}
              onChange={(v) => setAnswer(q.text, v)}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
