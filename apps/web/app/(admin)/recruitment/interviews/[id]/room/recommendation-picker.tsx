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
      <legend className="text-[12px] font-medium text-[#333] mb-2">{t.interviewRoom.recommendationLabel}</legend>
      <div className="flex flex-wrap gap-1.5">
        {RECOMMENDATIONS.map((rec) => {
          const checked = value === rec;
          return (
            <label
              key={rec}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#1F114C] ${
                checked
                  ? 'bg-[#1F114C] text-white border-[#1F114C]'
                  : 'bg-white text-[#585858] border-[#EDEDED] hover:border-[#8B8B8B]'
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
