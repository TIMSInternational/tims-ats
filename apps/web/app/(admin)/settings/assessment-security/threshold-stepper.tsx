'use client';

import { useI18n } from '../../../../lib/i18n';
import { MAX_THRESHOLD, MIN_THRESHOLD } from '../../../../lib/platform-api/assessment-provider-settings';
import { IconButton, inputClasses } from '../../../../components';

// The number of alerts allowed before the consequence applies: a stepper (− value +) bounded to the contract's 1..20.
export function ThresholdStepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n();
  const m = t.assessmentSecurity;
  const set = (next: number) => onChange(Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, next)));

  return (
    <div className="flex flex-col gap-1">
      <span id="threshold-label" className="text-body font-medium text-primary">
        {m.thresholdLabel}
      </span>
      <div className="flex items-center gap-2" role="group" aria-labelledby="threshold-label">
        <IconButton
          variant="secondary"
          label={m.thresholdDecrease}
          disabled={value <= MIN_THRESHOLD}
          onClick={() => set(value - 1)}
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M5 12h14" strokeLinecap="round" />
          </svg>
        </IconButton>
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
          className={inputClasses('md', 'w-16 text-center tabular-nums')}
        />
        <IconButton
          variant="secondary"
          label={m.thresholdIncrease}
          disabled={value >= MAX_THRESHOLD}
          onClick={() => set(value + 1)}
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </IconButton>
      </div>
      <p id="threshold-help" className="text-caption text-secondary">
        {m.thresholdHelp.replace('{min}', String(MIN_THRESHOLD)).replace('{max}', String(MAX_THRESHOLD))}
      </p>
    </div>
  );
}
