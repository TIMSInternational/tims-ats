'use client';

import { useState } from 'react';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { Field, TextInput } from '../../../../components';

interface NumberSettingFieldProps {
  label: string;
  help?: string;
  /** Shown after the box ("USD / mes", "min"). */
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** Round to a whole number before range-checking. */
  integer?: boolean;
  defaultValue: number | null;
  placeholder?: string;
  disabled?: boolean;
  /** Called on blur with the new value (null = cleared) when it is in range and changed. */
  onCommit: (value: number | null) => void;
}

/**
 * A number setting that saves on blur. An out-of-range value is kept in the box and explained under it
 * (entering-data.md › Best practices: "Dynamically validate field values"), instead of being dropped silently.
 */
export function NumberSettingField({
  label,
  help,
  unit,
  min,
  max,
  step,
  integer = false,
  defaultValue,
  placeholder,
  disabled,
  onCommit,
}: NumberSettingFieldProps) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  return (
    <Field label={label} help={help} error={error}>
      {(control) => (
        <div className="flex items-center gap-2">
          <TextInput
            {...control}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue ?? ''}
            placeholder={placeholder}
            disabled={disabled}
            className="w-32 tabular-nums"
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const parsed = raw === '' ? null : integer ? Math.round(Number(raw)) : Number(raw);
              if (parsed !== null && (Number.isNaN(parsed) || parsed < min || parsed > max)) {
                setError(formatMessage(t.aiAgents.outOfRange, { min, max }));
                return;
              }
              setError(null);
              if ((defaultValue ?? null) === parsed) return;
              onCommit(parsed);
            }}
          />
          {unit && <span className="text-body text-secondary">{unit}</span>}
        </div>
      )}
    </Field>
  );
}
