'use client';

import { useI18n } from '../../../../../lib/i18n';
import { LEGACY_CHOICE, MAX_OFFER_TERM_LENGTH, REMOTE_POLICIES, type Choice } from './create-offer-form';

export type OfferTermsValues = { schedule: string; modality: Choice; bonus: string; benefits: string };

const INPUT = 'mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]';
const LABEL = 'block text-[12px] font-medium text-[#585858]';

// The optional terms the offer card and letter show (Horario, Modalidad, Bono, Beneficios). Before, the form
// could not fill them, so the card always printed "—" (Pilot UX audit B-15).
export function CreateOfferTermsFields({
  values,
  onChange,
}: {
  values: OfferTermsValues;
  onChange: (patch: Partial<OfferTermsValues>) => void;
}) {
  const { t } = useI18n();
  const remote = t.portal.remotePolicies as Record<string, string>;

  return (
    <fieldset className="space-y-3 rounded-lg border border-[#F0F0F0] p-3">
      <legend className="px-1 text-[12px] font-semibold text-[#1F114C]">{t.offers.additionalTerms}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          {t.offers.schedule}
          <input
            type="text"
            maxLength={MAX_OFFER_TERM_LENGTH}
            value={values.schedule}
            placeholder={t.offers.schedulePlaceholder}
            onChange={(event) => onChange({ schedule: event.target.value })}
            className={INPUT}
          />
        </label>
        <label className={LABEL}>
          {t.offers.modality}
          <select
            value={values.modality.value}
            onChange={(event) => onChange({ modality: { value: event.target.value, legacy: values.modality.legacy } })}
            className={`${INPUT} bg-white`}
          >
            <option value="">{t.offers.modalityNotSpecified}</option>
            {REMOTE_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {remote[policy] ?? policy}
              </option>
            ))}
            {values.modality.legacy && <option value={LEGACY_CHOICE}>{values.modality.legacy}</option>}
          </select>
        </label>
      </div>
      <label className={LABEL}>
        {t.offers.bonusLabel}
        <input
          type="text"
          maxLength={MAX_OFFER_TERM_LENGTH}
          value={values.bonus}
          placeholder={t.offers.bonusPlaceholder}
          onChange={(event) => onChange({ bonus: event.target.value })}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        {t.offers.benefitsLabel}
        <textarea
          rows={3}
          maxLength={2200}
          value={values.benefits}
          placeholder={t.offers.benefitsPlaceholder}
          onChange={(event) => onChange({ benefits: event.target.value })}
          className={INPUT}
        />
      </label>
    </fieldset>
  );
}
