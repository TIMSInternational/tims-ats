'use client';

import { useMemo, useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import {
  useEngagementSurveyForResponse,
  useEngagementSubmitSurveyResponse,
} from '../../../lib/platform-api/engagement';
import { Modal, Skeleton } from '../../../components';
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
  const utils = trpc.useUtils();

  const survey = useEngagementSurveyForResponse(surveyId);
  const questions: SurveyQuestion[] = useMemo(
    () => parseSurveyQuestions(survey.data?.questions),
    [survey.data?.questions],
  );

  const [answers, setAnswers] = useState<Record<string, SurveyAnswer>>({});

  const setAnswer = (text: string, value: SurveyAnswer) => setAnswers((prev) => ({ ...prev, [text]: value }));

  const submit = useEngagementSubmitSurveyResponse({
    onSuccess: () => {
      utils.engagement.myPendingSurveys.invalidate();
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

  return (
    <Modal title={survey.data?.title ?? e.surveyTakeTitle} onClose={onClose}>
      {survey.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : survey.isError ? (
        <LoadError message={e.surveyNotFound} />
      ) : questions.length === 0 ? (
        <p className="text-[13px] text-[#8B8B8B]">{e.surveyNoQuestions}</p>
      ) : (
        <div className="space-y-4">
          {questions.map((q) => (
            <SurveyQuestionField
              key={q.text}
              question={q}
              value={answers[q.text]}
              disabled={submit.isPending}
              onChange={(v) => setAnswer(q.text, v)}
            />
          ))}

          {!requiredMet ? <p className="text-[11px] text-[#DD0C15]">{e.surveyRequiredError}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submit.isPending}
              className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {e.surveySubmit}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
