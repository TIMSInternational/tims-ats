'use client';

import type { UseFormReturn } from 'react-hook-form';
import { useI18n } from '../../../../../lib/i18n';
import {
  ACCOMMODATION_AIDS,
  AGE_BANDS,
  TIME_MULTIPLIERS,
} from '../../../../../lib/platform-api/assessment-providers-staff';

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

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12px] font-medium text-[#585858]">{ap.instrumentsLabel}</p>
        <ul className="mt-1 list-disc pl-5 text-[13px] text-[#1F114C]" data-testid="assign-instruments">
          {instrumentNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-[#8B8B8B]">{ap.instrumentsHint}</p>
        {notOffered > 0 && (
          <p className="mt-1 text-[11px] text-amber-700">{ap.notOffered.replace('{count}', String(notOffered))}</p>
        )}
      </div>

      <fieldset aria-describedby="assign-age-hint">
        <legend className="text-[12px] font-medium text-[#585858]">{ap.ageBandLabel}</legend>
        <div className="mt-1 flex gap-4">
          {AGE_BANDS.map((band) => (
            <label key={band} className="flex items-center gap-1.5 text-[13px] text-[#333]">
              <input type="radio" value={band} {...form.register('ageBand', { required: true })} />
              {band === '18_plus' ? ap.ageAdult : ap.ageMinor}
            </label>
          ))}
        </div>
        <p id="assign-age-hint" className={`mt-1 text-[11px] ${ageError ? 'text-[#B42318]' : 'text-[#8B8B8B]'}`}>
          {ap.ageHint}
        </p>
      </fieldset>

      <label className="block text-[12px] font-medium text-[#585858]">
        {ap.timeLabel}
        <select
          {...form.register('timeMultiplier')}
          className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]"
        >
          {TIME_MULTIPLIERS.map((multiplier) => (
            <option key={multiplier} value={String(multiplier)}>
              {multiplier === 1 ? ap.timeNone : `×${multiplier}`}
            </option>
          ))}
        </select>
      </label>

      <fieldset aria-describedby="assign-accommodation-hint">
        <legend className="text-[12px] font-medium text-[#585858]">{ap.aidsLabel}</legend>
        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
          {ACCOMMODATION_AIDS.map((aid) => (
            <label key={aid} className="flex items-center gap-1.5 text-[12px] text-[#333]">
              <input type="checkbox" value={aid} {...form.register('aids')} />
              {ap.aid[aid]}
            </label>
          ))}
        </div>
        <p id="assign-accommodation-hint" className="mt-1 text-[11px] text-[#8B8B8B]">
          {ap.accommodationHint}
        </p>
      </fieldset>
    </div>
  );
}
