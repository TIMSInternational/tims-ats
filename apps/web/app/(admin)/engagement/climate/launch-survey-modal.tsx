'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../../../lib/trpc';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import {
  Button,
  BUTTON_GROUP_CLASSES,
  Field,
  FIELD_LABEL_CLASSES,
  Modal,
  Select,
  TextInput,
} from '../../../../components';
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
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<SurveyType>('climate');
  const [questions, setQuestions] = useState<QuestionRow[]>([{ ...DEFAULT_QUESTION }]);

  const activate = useEngagementActivateSurvey({
    onSuccess: () => {
      // listSurveys is still tRPC-served (its own TS procedure was never a cutover
      // candidate — see engagement.ts's file header), so it still needs an explicit
      // tRPC-cache invalidate.
      utils.engagement.listSurveys.invalidate();
      // getDashboardKpis is C#-only now (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP live,
      // its TS procedure deleted 2026-07-31) — invalidate its platform-api cache key
      // directly instead of the dead trpc.engagement.getDashboardKpis cache.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'engagement', 'dashboard-kpis'] });
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
  const dirty = !isPending && (title.trim().length > 0 || questions.some((q) => q.text.trim().length > 0));

  return (
    <Modal
      title={t.climate.launchSurveyTitle}
      onClose={onClose}
      size="lg"
      dirty={dirty}
      footer={
        <div className="space-y-3">
          {/* The click creates AND activates: say so before the person commits. */}
          <p className="text-callout text-secondary">{t.climate.launchNotice}</p>
          <div className={BUTTON_GROUP_CLASSES}>
            <Button variant="secondary" onClick={onClose} disabled={isPending}>
              {t.common.cancel}
            </Button>
            <Button onClick={onSubmit} disabled={!canSubmit} loading={isPending} loadingLabel={t.climate.launching}>
              {t.climate.launchAction}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t.climate.surveyTitleLabel} required>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 200))}
            maxLength={200}
            disabled={isPending}
            autoFocus
          />
        </Field>

        <Field label={t.climate.surveyTypeLabel}>
          <Select value={type} onChange={(e) => setType(e.target.value as SurveyType)} disabled={isPending}>
            {SURVEY_TYPES.map((st) => (
              <option key={st.value} value={st.value}>
                {t.climate[st.labelKey]}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset>
          <legend className={FIELD_LABEL_CLASSES}>{t.climate.questionsLabel}</legend>
          <ol className="space-y-3">
            {questions.map((q, i) => {
              const n = i + 1;
              const textId = `survey-q-${i}-text`;
              const typeId = `survey-q-${i}-type`;
              return (
                <li
                  key={i}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end sm:border-0 sm:p-0"
                >
                  <div>
                    <label htmlFor={textId} className="mb-1 block text-callout font-medium text-secondary">
                      {formatMessage(t.climate.questionN, { n })}
                    </label>
                    <TextInput
                      id={textId}
                      value={q.text}
                      onChange={(e) =>
                        setQuestions(updateQuestion(questions, i, { text: e.target.value.slice(0, 500) }))
                      }
                      maxLength={500}
                      placeholder={t.climate.questionTextPlaceholder}
                      disabled={isPending}
                    />
                  </div>
                  <div>
                    <label htmlFor={typeId} className="mb-1 block text-callout font-medium text-secondary">
                      {t.climate.questionTypeLabel}
                    </label>
                    <Select
                      id={typeId}
                      value={q.type}
                      onChange={(e) =>
                        setQuestions(updateQuestion(questions, i, { type: e.target.value as QuestionType }))
                      }
                      disabled={isPending}
                    >
                      {QUESTION_TYPES.map((qt) => (
                        <option key={qt.value} value={qt.value}>
                          {t.climate[qt.labelKey]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    variant="tertiary"
                    onClick={() => setQuestions(removeQuestion(questions, i))}
                    disabled={isPending || questions.length <= 1}
                    aria-label={formatMessage(t.climate.removeQuestionN, { n })}
                  >
                    {t.climate.removeQuestion}
                  </Button>
                </li>
              );
            })}
          </ol>
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => setQuestions(addQuestion(questions))}
            disabled={isPending}
            className="mt-2"
          >
            + {t.climate.addQuestion}
          </Button>
        </fieldset>
      </div>
    </Modal>
  );
}
