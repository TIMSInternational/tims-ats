'use client';

import type { UseFormReturn } from 'react-hook-form';
import { useI18n } from '../../../../../lib/i18n';
import { CEFR_LEVELS, type InstrumentUse } from '../../../../../lib/platform-api/vacancy-assessments';
import type { StaffCatalogInstrument } from '../../../../../lib/platform-api/assessment-providers-staff';
import {
  allowedUses,
  jobCodeRequired,
  minimumKind,
  minimumRequired,
  takesWeight,
  type AssessmentForm,
} from '../../../../../lib/assessments/vacancy-assessment-form';

const FIELD = 'w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] disabled:opacity-60';
const LABEL = 'block text-[12px] font-medium text-[#585858]';
const ERROR = 'mt-1 text-[11px] text-[#B42318]';

// One configured test: how FIT uses it (only the uses its instrument allows), its minimum (the kind its instrument
// takes, required for a scored or gated use), its relative weight (scored, not English), PCA's TIMS position code
// (required when PCA is scored or gated: TIMS computes the fit to that position) and the job-relatedness reason
// (required). Notes explain D3 (English counts once, in Languages), D20 (LIA is a threshold until its norms are
// confirmed) and where PCA's fit comes from. Every field is labelled, and its error is tied to it with aria-describedby.
export function VacancyAssessmentRow({
  index,
  form,
  catalogEntry,
  catalogKnown,
  disabled,
  onRemove,
}: {
  index: number;
  form: UseFormReturn<AssessmentForm>;
  catalogEntry: StaffCatalogInstrument | null;
  catalogKnown: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const va = t.vacancyAssessments;
  const instrument = form.watch(`rows.${index}.instrument`);
  const use = form.watch(`rows.${index}.use`);
  const errors = form.formState.errors.rows?.[index];
  const kind = minimumKind(instrument);
  const uses = allowedUses(instrument);
  const name = t.candidates.fitInstrumentNames[instrument];
  const id = `vacancy-assessment-${index}`;
  const useLabels: Record<InstrumentUse, string> = {
    scored: va.useScored,
    gate: va.useGate,
    advisory: va.useAdvisory,
  };
  const minimumLabel = kind
    ? {
        globalPercentile: va.minimumGlobalPercentile,
        cefr: va.minimumCefr,
        level: va.minimumLevel,
        score: va.minimumScore,
        jobFit: va.minimumJobFit,
      }[kind]
    : null;
  const showJobCode = instrument === 'pca';
  const showWeight = takesWeight(instrument, use);
  const errorText = (key: string | undefined) => (key && key in va ? va[key as keyof typeof va] : null);

  return (
    <li className="rounded-lg border border-[#EDEDED] p-3 space-y-2" data-instrument={instrument}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#1F114C]">{name}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={va.removeAria.replace('{instrument}', name)}
          className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
        >
          {va.remove}
        </button>
      </div>

      {catalogEntry && (
        <p className="text-[11px] text-[#8B8B8B]">
          {catalogEntry.pinnedVersion
            ? va.versionPinned.replace('{version}', catalogEntry.pinnedVersion)
            : va.versionCurrent.replace(
                '{version}',
                catalogEntry.versions.find((v) => v.status === 'ga')?.instrumentVersion ??
                  catalogEntry.versions[0]?.instrumentVersion ??
                  '',
              )}
        </p>
      )}
      {!catalogEntry && catalogKnown && instrument !== 'native_quiz' && (
        <p className="text-[11px] text-amber-700">{va.notInCatalog}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${id}-use`} className={LABEL}>
            {va.useLabel}
          </label>
          <select
            id={`${id}-use`}
            {...form.register(`rows.${index}.use`)}
            disabled={disabled || uses.length === 1}
            className={`mt-1 ${FIELD}`}
          >
            {uses.map((u) => (
              <option key={u} value={u}>
                {useLabels[u]}
              </option>
            ))}
          </select>
        </div>

        {kind && use !== 'advisory' && (
          <div>
            <label htmlFor={`${id}-min`} className={LABEL}>
              {minimumLabel}
              {!minimumRequired(instrument, use) && ` ${va.minimumOptional}`}
            </label>
            {kind === 'cefr' ? (
              <select
                id={`${id}-min`}
                {...form.register(`rows.${index}.minimum`)}
                disabled={disabled}
                aria-invalid={Boolean(errors?.minimum)}
                aria-describedby={errors?.minimum ? `${id}-min-error` : undefined}
                className={`mt-1 ${FIELD}`}
              >
                <option value="">{va.minimumChoose}</option>
                {CEFR_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${id}-min`}
                type="number"
                inputMode="decimal"
                min={kind === 'level' ? 1 : 0}
                max={kind === 'level' ? 5 : 100}
                step={kind === 'level' ? 1 : 'any'}
                {...form.register(`rows.${index}.minimum`)}
                disabled={disabled}
                aria-invalid={Boolean(errors?.minimum)}
                aria-describedby={errors?.minimum ? `${id}-min-error` : undefined}
                className={`mt-1 ${FIELD}`}
              />
            )}
            {errors?.minimum && (
              <p id={`${id}-min-error`} className={ERROR}>
                {errorText(errors.minimum.message)}
              </p>
            )}
          </div>
        )}
      </div>

      {(showJobCode || showWeight) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {showJobCode && (
            <div>
              <label htmlFor={`${id}-job-code`} className={LABEL}>
                {va.jobCodeLabel}
                {!jobCodeRequired(instrument, use) && ` ${va.minimumOptional}`}
              </label>
              <input
                id={`${id}-job-code`}
                type="text"
                maxLength={30}
                autoComplete="off"
                spellCheck={false}
                placeholder="194225"
                {...form.register(`rows.${index}.jobCode`)}
                disabled={disabled}
                aria-invalid={Boolean(errors?.jobCode)}
                aria-describedby={`${id}-job-code-hint${errors?.jobCode ? ` ${id}-job-code-error` : ''}`}
                className={`mt-1 ${FIELD}`}
              />
              <p id={`${id}-job-code-hint`} className="mt-1 text-[11px] text-[#8B8B8B]">
                {va.jobCodeHint}
              </p>
              {errors?.jobCode && (
                <p id={`${id}-job-code-error`} className={ERROR}>
                  {errorText(errors.jobCode.message)}
                </p>
              )}
            </div>
          )}
          {showWeight && (
            <div>
              <label htmlFor={`${id}-weight`} className={LABEL}>
                {va.weightLabel} {va.minimumOptional}
              </label>
              <input
                id={`${id}-weight`}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="any"
                {...form.register(`rows.${index}.weight`)}
                disabled={disabled}
                aria-invalid={Boolean(errors?.weight)}
                aria-describedby={`${id}-weight-hint${errors?.weight ? ` ${id}-weight-error` : ''}`}
                className={`mt-1 ${FIELD}`}
              />
              <p id={`${id}-weight-hint`} className="mt-1 text-[11px] text-[#8B8B8B]">
                {va.weightHint}
              </p>
              {errors?.weight && (
                <p id={`${id}-weight-error`} className={ERROR}>
                  {errorText(errors.weight.message)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <label htmlFor={`${id}-reason`} className={LABEL}>
        {va.reasonLabel}
      </label>
      <textarea
        id={`${id}-reason`}
        rows={2}
        maxLength={500}
        {...form.register(`rows.${index}.reason`)}
        disabled={disabled}
        required
        placeholder={va.reasonPlaceholder}
        aria-invalid={Boolean(errors?.reason)}
        aria-describedby={`${id}-reason-hint${errors?.reason ? ` ${id}-reason-error` : ''}`}
        className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 py-2 text-[13px] text-[#333] disabled:opacity-60"
      />
      <p id={`${id}-reason-hint`} className="text-[11px] text-[#8B8B8B]">
        {va.reasonHint}
      </p>
      {errors?.reason && (
        <p id={`${id}-reason-error`} className={ERROR}>
          {errorText(errors.reason.message)}
        </p>
      )}
      {errors?.use && <p className={ERROR}>{errorText(errors.use.message)}</p>}

      {instrument === 'english' && use !== 'advisory' && <p className="text-[11px] text-[#585858]">{va.noteEnglish}</p>}
      {instrument === 'lia' && use === 'scored' && <p className="text-[11px] text-[#585858]">{va.noteLia}</p>}
      {instrument === 'pca' && <p className="text-[11px] text-[#585858]">{va.notePcaJobFit}</p>}
      {uses.length === 1 && <p className="text-[11px] text-[#585858]">{va.noteAdvisoryOnly}</p>}
    </li>
  );
}
