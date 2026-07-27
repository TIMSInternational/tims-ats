'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { useEngagementCreateSurvey, useEngagementActivateSurvey } from '../../../../lib/platform-api/engagement';
import {
  addQuestion,
  removeQuestion,
  updateQuestion,
  DEFAULT_QUESTION,
  type QuestionRow,
  type QuestionType,
} from './question-builder';

export { addQuestion, removeQuestion, updateQuestion } from './question-builder';

interface LaunchSurveyModalProps {
  onClose: () => void;
}

type SurveyType = 'pulse' | 'enps' | 'climate' | 'custom';

const SURVEY_TYPES: { value: SurveyType; labelKey: 'typePulse' | 'typeEnps' | 'typeClimate' | 'typeCustom' }[] = [
  { value: 'pulse', labelKey: 'typePulse' },
  { value: 'enps', labelKey: 'typeEnps' },
  { value: 'climate', labelKey: 'typeClimate' },
  { value: 'custom', labelKey: 'typeCustom' },
];

const QUESTION_TYPES: {
  value: QuestionType;
  labelKey: 'qtypeScale' | 'qtypeText' | 'qtypeMultipleChoice' | 'qtypeYesNo';
}[] = [
  { value: 'scale', labelKey: 'qtypeScale' },
  { value: 'text', labelKey: 'qtypeText' },
  { value: 'multiple_choice', labelKey: 'qtypeMultipleChoice' },
  { value: 'yes_no', labelKey: 'qtypeYesNo' },
];

export function LaunchSurveyModal({ onClose }: LaunchSurveyModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<SurveyType>('climate');
  const [questions, setQuestions] = useState<QuestionRow[]>([{ ...DEFAULT_QUESTION }]);

  const activate = useEngagementActivateSurvey({
    onSuccess: () => {
      utils.engagement.listSurveys.invalidate();
      utils.engagement.getDashboardKpis.invalidate();
      toast(t.climate.launchSurveySuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const create = useEngagementCreateSurvey({
    onSuccess: (survey) => activate.mutate({ id: survey.id }),
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canSubmit =
    title.trim().length > 0 &&
    questions.length >= 1 &&
    questions.every((q) => q.text.trim().length > 0) &&
    !create.isPending &&
    !activate.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    create.mutate({
      title: title.trim(),
      type,
      questions: questions.map((q) => ({ text: q.text.trim(), type: q.type, required: true })),
    });
  };

  const isPending = create.isPending || activate.isPending;

  return (
    <Modal title={t.climate.launchSurveyTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.climate.surveyTitleLabel}</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 200))}
            maxLength={200}
            disabled={isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.climate.surveyTypeLabel}</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SurveyType)}
            disabled={isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          >
            {SURVEY_TYPES.map((st) => (
              <option key={st.value} value={st.value}>
                {t.climate[st.labelKey]}
              </option>
            ))}
          </select>
        </div>

        {/* Questions */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.climate.questionsLabel}</label>
          <div className="space-y-2">
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  value={q.text}
                  onChange={(e) => setQuestions(updateQuestion(questions, i, { text: e.target.value.slice(0, 500) }))}
                  maxLength={500}
                  placeholder={t.climate.questionTextPlaceholder}
                  disabled={isPending}
                  className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
                />
                <div className="flex flex-col gap-0.5">
                  <label className="block text-[12px] font-medium text-[#333] mb-1.5">
                    {t.climate.questionTypeLabel}
                  </label>
                  <select
                    value={q.type}
                    onChange={(e) =>
                      setQuestions(updateQuestion(questions, i, { type: e.target.value as QuestionType }))
                    }
                    disabled={isPending}
                    className="w-36 border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
                  >
                    {QUESTION_TYPES.map((qt) => (
                      <option key={qt.value} value={qt.value}>
                        {t.climate[qt.labelKey]}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setQuestions(removeQuestion(questions, i))}
                  disabled={isPending || questions.length <= 1}
                  className="h-9 px-3 rounded-lg text-[12px] text-[#DD0C15] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-30"
                >
                  {t.climate.removeQuestion}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setQuestions(addQuestion(questions))}
            disabled={isPending}
            className="mt-2 text-[12px] text-[#1F114C] hover:underline disabled:opacity-50"
          >
            + {t.climate.addQuestion}
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
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
            {isPending ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>
    </Modal>
  );
}
