'use client';

import { MAX_FREE_TEXT } from '@tims/shared';
import { forwardRef } from 'react';
import { useI18n } from '../../../../../../../../lib/i18n';
import { CHOICE_INPUT_CLASSES, textareaClasses } from '../../../../../../../../components';

export interface QuestionCardOption {
  id: string;
  label: string;
}

export interface QuestionCardQuestion {
  id: string;
  order: number;
  type: 'single_choice' | 'multi_choice' | 'free_text';
  prompt: string;
  options: QuestionCardOption[];
  points: number;
}

export interface QuestionCardAnswer {
  selectedOptionIds?: string[];
  freeText?: string;
}

interface AssessmentQuestionCardProps {
  question: QuestionCardQuestion;
  answer: QuestionCardAnswer | undefined;
  onChange: (answer: QuestionCardAnswer) => void;
}

const PROMPT_CLASSES = 'text-heading font-semibold text-primary outline-none';

// One question as a fieldset whose legend is the prompt, so each option is announced with its question
// (accessibility.md › Mobility). The legend takes focus (ref) when the wizard moves to this question.
export const AssessmentQuestionCard = forwardRef<HTMLElement, AssessmentQuestionCardProps>(
  function AssessmentQuestionCard({ question, answer, onChange }, promptRef) {
    const { t } = useI18n();
    const selected = answer?.selectedOptionIds ?? [];
    const promptId = `question-${question.id}-prompt`;

    if (question.type === 'free_text') {
      return (
        <div className="space-y-3">
          <p id={promptId} ref={promptRef as React.Ref<HTMLParagraphElement>} tabIndex={-1} className={PROMPT_CLASSES}>
            {question.prompt}
          </p>
          <textarea
            value={answer?.freeText ?? ''}
            maxLength={MAX_FREE_TEXT}
            onChange={(e) => onChange({ freeText: e.target.value })}
            placeholder={t.assessmentPlayer.questionCardFreeTextPlaceholder}
            aria-labelledby={promptId}
            rows={6}
            className={textareaClasses('min-h-32')}
          />
        </div>
      );
    }

    const toggleSingle = (optionId: string) => onChange({ selectedOptionIds: [optionId] });
    const toggleMulti = (optionId: string) => {
      const next = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId];
      onChange({ selectedOptionIds: next });
    };

    return (
      <fieldset className="space-y-3">
        <legend ref={promptRef as React.Ref<HTMLLegendElement>} tabIndex={-1} className={`mb-3 ${PROMPT_CLASSES}`}>
          {question.prompt}
        </legend>
        <ul className="space-y-2">
          {question.options.map((option) => (
            <li key={option.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-brand/40 has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
                <input
                  type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                  name={`question-${question.id}`}
                  checked={selected.includes(option.id)}
                  onChange={() =>
                    question.type === 'single_choice' ? toggleSingle(option.id) : toggleMulti(option.id)
                  }
                  className={CHOICE_INPUT_CLASSES}
                />
                <span className="text-body text-primary">{option.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    );
  },
);
