'use client';

import { useId } from 'react';
import { useI18n } from '../../../lib/i18n';
import { formatMessage } from '../../../lib/i18n/format';
import {
  CHOICE_INPUT_CLASSES,
  CHOICE_ROW_CLASSES,
  FIELD_LABEL_CLASSES,
  textareaClasses,
} from '../../../components/field-styles';
import type { SurveyQuestion, SurveyAnswer } from './survey-question';

const MAX_TEXT = 5000;

interface SurveyQuestionFieldProps {
  question: SurveyQuestion;
  value: SurveyAnswer | undefined;
  disabled: boolean;
  onChange: (value: SurveyAnswer) => void;
}

// Inclusive integer range [min..max] for a numeric scale (scale + nps both map
// to `kind: 'scale'` with their actual stored range — never hardcoded 1..5).
function scaleValues(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

const OPTION_TEXT = 'text-body text-primary';

// Renders ONE survey question as the input matching its normalized `kind`, with the question as the
// control's accessible name: a label element (htmlFor) for text, and a fieldset with a legend for every
// choice group.
// Extracted from survey-take-modal.tsx to keep both files under the 300-line limit.
export function SurveyQuestionField({ question, value, disabled, onChange }: SurveyQuestionFieldProps) {
  const { t } = useI18n();
  const e = t.employeeHome;
  const id = useId();
  const anchorsId = `${id}-anchors`;

  const title = (
    <>
      {question.text}
      {question.required ? (
        <>
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> {e.surveyRequiredSr}</span>
        </>
      ) : null}
    </>
  );

  if (question.kind === 'text') {
    return (
      <div>
        <label htmlFor={id} className={FIELD_LABEL_CLASSES}>
          {title}
        </label>
        <textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(ev) => onChange(ev.target.value.slice(0, MAX_TEXT))}
          maxLength={MAX_TEXT}
          rows={3}
          disabled={disabled}
          aria-required={question.required || undefined}
          className={textareaClasses('resize-none')}
        />
      </div>
    );
  }

  return (
    <fieldset aria-describedby={question.kind === 'scale' ? anchorsId : undefined}>
      <legend className={FIELD_LABEL_CLASSES}>{title}</legend>

      {question.kind === 'scale' ? (
        <div>
          <div className="flex flex-wrap gap-2">
            {scaleValues(question.min, question.max).map((n) => (
              <label key={n} className="relative">
                <input
                  type="radio"
                  name={id}
                  value={n}
                  checked={value === n}
                  disabled={disabled}
                  onChange={() => onChange(n)}
                  aria-label={formatMessage(e.surveyScaleOption, { value: n, max: question.max })}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-field-border text-body tabular-nums text-secondary transition-colors hover:bg-surface peer-checked:border-brand peer-checked:bg-brand peer-checked:font-medium peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand peer-disabled:cursor-not-allowed peer-disabled:opacity-50 pointer-coarse:size-11"
                >
                  {n}
                </span>
              </label>
            ))}
          </div>
          <div id={anchorsId} className="mt-1 flex justify-between text-caption text-muted">
            <span>{e.surveyScaleLow}</span>
            <span>{e.surveyScaleHigh}</span>
          </div>
        </div>
      ) : null}

      {question.kind === 'choice' ? (
        <div className="space-y-1">
          {question.options.map((opt) => (
            <label key={opt} className={`${CHOICE_ROW_CLASSES} ${OPTION_TEXT}`}>
              <input
                type="radio"
                name={id}
                checked={value === opt}
                disabled={disabled}
                onChange={() => onChange(opt)}
                className={CHOICE_INPUT_CLASSES}
              />
              {opt}
            </label>
          ))}
        </div>
      ) : null}

      {question.kind === 'yes_no' ? (
        <div className="flex gap-6">
          {[
            { v: 'yes', label: e.surveyYes },
            { v: 'no', label: e.surveyNo },
          ].map(({ v, label }) => (
            <label key={v} className={`${CHOICE_ROW_CLASSES} ${OPTION_TEXT}`}>
              <input
                type="radio"
                name={id}
                checked={value === v}
                disabled={disabled}
                onChange={() => onChange(v)}
                className={CHOICE_INPUT_CLASSES}
              />
              {label}
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
