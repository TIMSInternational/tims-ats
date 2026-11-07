'use client';

import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { normalizeMoneyText, parseMoneyAmount, type MoneyAmountError } from '../lib/money-amount';

/**
 * The ONE input for a typed money amount (vacancy salary band, offer salary). A text field, not
 * <input type="number">: nothing steps the value (a wheel or arrow key once turned CRC 1 000 000 into
 * 1 000 000.01), digit grouping is accepted as people write it ("1.000.000", "1,000,000", "1 000 000") and
 * shown grouped once the person leaves the field, and a zero-decimal currency (CRC, COP…) takes whole numbers
 * only. The parent keeps the text and parses it with lib/money-amount.ts when it validates or submits.
 */
export interface MoneyInputProps {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  /** ISO code of the amount: decides whether decimals are allowed. */
  currency: string;
  /** Inclusive cap, in the same unit as the amount. */
  max?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export function moneyErrorText(
  error: MoneyAmountError,
  currency: string,
  labels: { invalid: string; decimals: string; tooLarge: string },
): string {
  if (error === 'decimals') return labels.decimals.replace('{currency}', currency.trim().toUpperCase());
  return error === 'tooLarge' ? labels.tooLarge : labels.invalid;
}

export function MoneyInput({
  id,
  value,
  onChange,
  currency,
  max,
  placeholder,
  className,
  disabled,
  ...aria
}: MoneyInputProps) {
  const { t } = useI18n();
  // Errors wait until the person leaves the field: "1." is a normal half-typed amount.
  const [editing, setEditing] = useState(false);
  const parsed = parseMoneyAmount(value, currency, { max });
  const error = !editing && parsed.kind === 'error' ? moneyErrorText(parsed.error, currency, t.money) : null;
  const errorId = id ? `${id}-error` : undefined;

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        aria-label={aria['aria-label']}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onFocus={() => setEditing(true)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          setEditing(false);
          const next = normalizeMoneyText(value, currency);
          if (next !== value) onChange(next);
        }}
      />
      {error && (
        <span id={errorId} role="alert" className="mt-1 block text-[11px] text-[#991b1b]">
          {error}
        </span>
      )}
    </>
  );
}
