'use client';

import { useI18n } from '../../../../lib/i18n';
import { currencyOptions } from '../../../../lib/currency-options';
import { timeZoneOptions } from '../../../../lib/time-zone-options';
import { formatMoneyCode } from '../../../../lib/offer-salary';
import { countryLabel, languageLabel } from '../../../../lib/org-profile-format';
import {
  OTHER_COUNTRY,
  PRESET_COUNTRY_CODES,
  applyCountryChoice,
  localeOptions,
  orgLocaleFormToProfile,
  sanitizeCountryCode,
  type OrgLocaleForm,
} from '../../../../lib/org-locale-form';

const LABEL_CLS = 'text-xs font-medium text-[#585858] mb-1 block';
const FIELD_CLS =
  'w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20';

const SAMPLE_AMOUNT = 1_234_567.5;

/**
 * Country (required), then the time zone, currency and number locale it implies — each editable. Used by
 * "Nueva organización", "Invitar organización" and the platform owner's edit. Controlled: the parent owns
 * the OrgLocaleForm value.
 */
export function OrgLocaleFields({
  idPrefix,
  value,
  onChange,
  hint,
  required = true,
}: {
  /** False on the edit form: an organization created before profiles may have no locale yet. */
  required?: boolean;
  idPrefix: string;
  value: OrgLocaleForm;
  onChange: (next: OrgLocaleForm) => void;
  hint?: string;
}) {
  const { t, locale: uiLocale } = useI18n();
  const m = t.orgLocale;
  const ui = uiLocale === 'EN' ? 'en' : 'es';
  const set = (patch: Partial<OrgLocaleForm>) => onChange({ ...value, ...patch });
  const zones = timeZoneOptions(ui, value.timezone || null);
  const currencies = currencyOptions();
  const locales = localeOptions(value.locale);
  const profile = orgLocaleFormToProfile(value);
  const countryName = (code: string) => (countryLabel(code, ui) ?? code).replace(/ \([A-Z]{2}\)$/, '');

  return (
    <fieldset className="space-y-3 rounded-lg border border-[#EDEDED] p-3">
      <legend className="px-1 text-xs font-semibold text-[#333]">{m.legend}</legend>
      <p className="text-[11px] text-[#8B8B8B]">{hint ?? m.hint}</p>
      <div>
        <label htmlFor={`${idPrefix}-country`} className={LABEL_CLS}>
          {m.country}{required ? ' *' : ''}
        </label>
        <select
          id={`${idPrefix}-country`}
          required={required}
          value={value.choice}
          onChange={(e) => onChange(applyCountryChoice(value, e.target.value))}
          className={FIELD_CLS}
        >
          <option value="" disabled>
            {m.countryPlaceholder}
          </option>
          {PRESET_COUNTRY_CODES.map((code) => (
            <option key={code} value={code}>
              {countryName(code)}
            </option>
          ))}
          <option value={OTHER_COUNTRY}>{m.countryOther}</option>
        </select>
      </div>
      {value.choice === OTHER_COUNTRY && (
        <div>
          <label htmlFor={`${idPrefix}-country-code`} className={LABEL_CLS}>
            {m.countryCode} *
          </label>
          <input
            id={`${idPrefix}-country-code`}
            required
            maxLength={2}
            pattern="^[A-Z]{2}$"
            value={value.country}
            onChange={(e) => set({ country: sanitizeCountryCode(e.target.value) })}
            placeholder={m.countryCodePlaceholder}
            className={`${FIELD_CLS} font-mono uppercase`}
          />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-timezone`} className={LABEL_CLS}>
            {m.timeZone}{required ? ' *' : ''}
          </label>
          <select
            id={`${idPrefix}-timezone`}
            required={required}
            value={value.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
            className={FIELD_CLS}
          >
            <option value="" disabled>
              —
            </option>
            {zones.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-currency`} className={LABEL_CLS}>
            {m.currency}{required ? ' *' : ''}
          </label>
          <select
            id={`${idPrefix}-currency`}
            required={required}
            value={value.currency}
            onChange={(e) => set({ currency: e.target.value })}
            className={FIELD_CLS}
          >
            <option value="" disabled>
              —
            </option>
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-locale`} className={LABEL_CLS}>
          {m.locale}{required ? ' *' : ''}
        </label>
        <select
          id={`${idPrefix}-locale`}
          required={required}
          value={value.locale}
          onChange={(e) => set({ locale: e.target.value })}
          className={FIELD_CLS}
        >
          <option value="" disabled>
            —
          </option>
          {locales.map((tag) => (
            <option key={tag} value={tag}>{`${languageLabel(tag, ui) ?? tag} · ${tag}`}</option>
          ))}
        </select>
        {profile && (
          <p className="mt-1 text-[11px] text-[#8B8B8B]">
            {m.sample.replace('{sample}', formatMoneyCode(SAMPLE_AMOUNT, profile.currency, profile.locale))}
          </p>
        )}
      </div>
    </fieldset>
  );
}
