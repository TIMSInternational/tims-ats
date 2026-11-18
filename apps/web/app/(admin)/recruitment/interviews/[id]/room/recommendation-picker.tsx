'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { RECOMMENDATIONS, type Recommendation } from './scorecard-model';

export const RECOMMENDATION_LABEL_KEYS = {
  strong_yes: 'recStrongYes',
  yes: 'recYes',
  neutral: 'recNeutral',
  no: 'recNo',
  strong_no: 'recStrongNo',
} as const satisfies Record<Recommendation, string>;

interface RecommendationPickerProps {
  value: Recommendation | null;
  onChange: (value: Recommendation) => void;
  disabled?: boolean;
}

/** Native radio inputs: keyboard + screen-reader behaviour comes for free. */
export function RecommendationPicker({ value, onChange, disabled = false }: RecommendationPickerProps) {
  const { t } = useI18n();
  return (
    <fieldset className="mb-4" disabled={disabled}>
      <legend className="text-callout font-medium text-primary mb-2">{t.interviewRoom.recommendationLabel}</legend>
      <div className="flex flex-wrap gap-1.5">
        {RECOMMENDATIONS.map((rec) => {
          const checked = value === rec;
          return (
            <label
              key={rec}
              className={`inline-flex min-h-8 cursor-pointer items-center rounded-full border px-3 text-callout transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 pointer-coarse:min-h-11 ${
                checked
                  ? 'bg-brand text-white border-brand'
                  : 'bg-white text-secondary border-field-border hover:border-secondary'
              }`}
            >
              <input
                type="radio"
                name="scorecard-recommendation"
                value={rec}
                checked={checked}
                onChange={() => onChange(rec)}
                className="sr-only"
              />
              {t.interviewRoom[RECOMMENDATION_LABEL_KEYS[rec]]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
