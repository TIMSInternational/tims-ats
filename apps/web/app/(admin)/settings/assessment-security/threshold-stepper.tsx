'use client';

import { useI18n } from '../../../../lib/i18n';
import { MAX_THRESHOLD, MIN_THRESHOLD } from '../../../../lib/platform-api/assessment-provider-settings';

// The number of alerts allowed before the consequence applies: a stepper (− value +) bounded to the contract's 1..20.
export function ThresholdStepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n();
  const m = t.assessmentSecurity;
  const set = (next: number) => onChange(Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, next)));
  const buttonCls =
    'h-9 w-9 rounded-lg border border-[#EDEDED] text-base font-semibold text-[#1F114C] hover:bg-[#F6F6F6] disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col gap-1">
      <span id="threshold-label" className="text-[12px] font-medium text-[#585858]">
        {m.thresholdLabel}
      </span>
      <div className="flex items-center gap-2" role="group" aria-labelledby="threshold-label">
        <button
          type="button"
          className={buttonCls}
          aria-label={m.thresholdDecrease}
          disabled={value <= MIN_THRESHOLD}
          onClick={() => set(value - 1)}
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_THRESHOLD}
          max={MAX_THRESHOLD}
          value={value}
          aria-labelledby="threshold-label"
          aria-describedby="threshold-help"
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(parsed)) set(parsed);
          }}
          className="h-9 w-16 rounded-lg border border-[#EDEDED] text-center text-sm text-[#1F114C]"
        />
        <button
          type="button"
          className={buttonCls}
          aria-label={m.thresholdIncrease}
          disabled={value >= MAX_THRESHOLD}
          onClick={() => set(value + 1)}
        >
          +
        </button>
      </div>
      <p id="threshold-help" className="text-[11px] text-[#8B8B8B]">
        {m.thresholdHelp.replace('{min}', String(MIN_THRESHOLD)).replace('{max}', String(MAX_THRESHOLD))}
      </p>
    </div>
  );
}
