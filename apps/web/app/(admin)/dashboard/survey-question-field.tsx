'use client';

import { useI18n } from '../../../lib/i18n';
import type { SurveyQuestion, SurveyAnswer } from './survey-question';

const MAX_TEXT = 5000;
const SCALE_VALUES = [1, 2, 3, 4, 5] as const;

interface SurveyQuestionFieldProps {
  question: SurveyQuestion;
  value: SurveyAnswer | undefined;
  disabled: boolean;
  onChange: (value: SurveyAnswer) => void;
}

// Renders ONE survey question as the input matching its type. Extracted from
// survey-take-modal.tsx to keep both files under the 300-line limit.
export function SurveyQuestionField({ question, value, disabled, onChange }: SurveyQuestionFieldProps) {
  const { t } = useI18n();
  const e = t.employeeHome;

  return (
    <div>
      <label className="block text-[12px] font-medium text-[#333] mb-1.5">
        {question.text}
        {question.required ? <span className="text-[#DD0C15] ml-0.5">*</span> : null}
      </label>

      {question.type === 'scale' ? (
        <div>
          <div className="flex gap-2">
            {SCALE_VALUES.map((n) => (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => onChange(n)}
                aria-pressed={value === n}
                className={
                  value === n
                    ? 'h-9 w-9 rounded-lg text-[13px] font-medium bg-[#1F114C] text-white transition disabled:opacity-50'
                    : 'h-9 w-9 rounded-lg text-[13px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-50'
                }
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-[#8B8B8B] mt-1">
            <span>{e.surveyScaleLow}</span>
            <span>{e.surveyScaleHigh}</span>
          </div>
        </div>
      ) : null}

      {question.type === 'text' ? (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(ev) => onChange(ev.target.value.slice(0, MAX_TEXT))}
          maxLength={MAX_TEXT}
          rows={3}
          disabled={disabled}
          className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
        />
      ) : null}

      {question.type === 'multiple_choice' ? (
        <div className="space-y-1.5">
          {(question.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-[13px] text-[#333]">
              <input
                type="radio"
                name={question.text}
                checked={value === opt}
                disabled={disabled}
                onChange={() => onChange(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      ) : null}

      {question.type === 'yes_no' ? (
        <div className="flex gap-4">
          {[
            { v: 'yes', label: e.surveyYes },
            { v: 'no', label: e.surveyNo },
          ].map(({ v, label }) => (
            <label key={v} className="flex items-center gap-2 text-[13px] text-[#333]">
              <input
                type="radio"
                name={question.text}
                checked={value === v}
                disabled={disabled}
                onChange={() => onChange(v)}
              />
              {label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
