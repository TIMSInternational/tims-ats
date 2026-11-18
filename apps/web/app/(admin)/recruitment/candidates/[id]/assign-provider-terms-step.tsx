'use client';

import type { UseFormReturn } from 'react-hook-form';
import { useI18n } from '../../../../../lib/i18n';
import {
  ACCOMMODATION_AIDS,
  AGE_BANDS,
  TIME_MULTIPLIERS,
} from '../../../../../lib/platform-api/assessment-providers-staff';
import {
  CHOICE_INPUT_CLASSES,
  CHOICE_ROW_CLASSES,
  FIELD_ERROR_CLASSES,
  FIELD_HELP_CLASSES,
  FIELD_LABEL_CLASSES,
  selectClasses,
} from '../../../../../components';

export interface AssignTermsForm {
  /** One of AGE_BANDS once chosen; empty until HR attests it. */
  ageBand: string;
  timeMultiplier: string;
  aids: string[];
}

// Step 1 of assigning a vacancy's tests: the tests (fixed by the vacancy, shown read-only: every candidate gets the
// same ones), the attested age band (required: the provider never defaults it) and the accommodation (extra time and
// aids; only the adjustment is recorded, never its reason).
export function AssignProviderTermsStep({
  form,
  instrumentNames,
  notOffered,
}: {
  form: UseFormReturn<AssignTermsForm>;
  instrumentNames: string[];
  notOffered: number;
}) {
  const { t } = useI18n();
  const ap = t.assignProviderAssessments;
  const ageError = form.formState.errors.ageBand;
  const ageDescribedBy = ['assign-age-hint', ageError ? 'assign-age-error' : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-4">
      <div>
        <p className={FIELD_LABEL_CLASSES}>{ap.instrumentsLabel}</p>
        <ul className="list-disc pl-5 text-body text-primary" data-testid="assign-instruments">
          {instrumentNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className={FIELD_HELP_CLASSES}>{ap.instrumentsHint}</p>
        {notOffered > 0 && (
          <p className="mt-1 text-callout text-warning">{ap.notOffered.replace('{count}', String(notOffered))}</p>
        )}
      </div>

      <fieldset aria-describedby={ageDescribedBy}>
        <legend className={FIELD_LABEL_CLASSES}>
          {ap.ageBandLabel}
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        </legend>
        <div className="flex flex-wrap gap-x-6">
          {AGE_BANDS.map((band) => (
            <label key={band} className={CHOICE_ROW_CLASSES}>
              <input
                type="radio"
                value={band}
                className={CHOICE_INPUT_CLASSES}
                {...form.register('ageBand', { required: true })}
              />
              {band === '18_plus' ? ap.ageAdult : ap.ageMinor}
            </label>
          ))}
        </div>
        <p id="assign-age-hint" className={FIELD_HELP_CLASSES}>
          {ap.ageHint}
        </p>
        {ageError && (
          <p id="assign-age-error" role="alert" className={FIELD_ERROR_CLASSES}>
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
            <span>{ap.ageRequired}</span>
          </p>
        )}
      </fieldset>

      <label className={FIELD_LABEL_CLASSES}>
        {ap.timeLabel}
        <select {...form.register('timeMultiplier')} className={`mt-1.5 font-normal ${selectClasses()}`}>
          {TIME_MULTIPLIERS.map((multiplier) => (
            <option key={multiplier} value={String(multiplier)}>
              {multiplier === 1 ? ap.timeNone : `×${multiplier}`}
            </option>
          ))}
        </select>
      </label>

      <fieldset aria-describedby="assign-accommodation-hint">
        <legend className={FIELD_LABEL_CLASSES}>{ap.aidsLabel}</legend>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {ACCOMMODATION_AIDS.map((aid) => (
            <label key={aid} className={CHOICE_ROW_CLASSES}>
              <input type="checkbox" value={aid} className={CHOICE_INPUT_CLASSES} {...form.register('aids')} />
              {ap.aid[aid]}
            </label>
          ))}
        </div>
        <p id="assign-accommodation-hint" className={FIELD_HELP_CLASSES}>
          {ap.accommodationHint}
        </p>
      </fieldset>
    </div>
  );
}
