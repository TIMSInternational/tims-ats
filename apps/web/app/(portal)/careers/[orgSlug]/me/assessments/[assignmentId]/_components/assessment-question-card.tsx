'use client';

import { MAX_FREE_TEXT } from '@tims/shared';
import { useI18n } from '../../../../../../../../lib/i18n';

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

export function AssessmentQuestionCard({ question, answer, onChange }: AssessmentQuestionCardProps) {
  const { t } = useI18n();
  const selected = answer?.selectedOptionIds ?? [];

  if (question.type === 'free_text') {
    return (
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-[#1F114C]">{question.prompt}</p>
        <textarea
          value={answer?.freeText ?? ''}
          maxLength={MAX_FREE_TEXT}
          onChange={(e) => onChange({ freeText: e.target.value })}
          placeholder={t.assessmentPlayer.questionCardFreeTextPlaceholder}
          rows={6}
          className="w-full rounded-xl border border-[#E5E5E5] p-3 text-[13px] text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
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
    <div className="space-y-3">
      <p className="text-[14px] font-medium text-[#1F114C]">{question.prompt}</p>
      <ul className="space-y-2">
        {question.options.map((option) => (
          <li key={option.id}>
            <label className="flex items-center gap-3 rounded-xl border border-[#EDEDED] p-3 cursor-pointer hover:border-[#1F114C]/40">
              <input
                type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                name={`question-${question.id}`}
                checked={selected.includes(option.id)}
                onChange={() => (question.type === 'single_choice' ? toggleSingle(option.id) : toggleMulti(option.id))}
                className="h-4 w-4 text-[#1F114C] focus:ring-[#1F114C]"
              />
              <span className="text-[13px] text-[#333]">{option.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
