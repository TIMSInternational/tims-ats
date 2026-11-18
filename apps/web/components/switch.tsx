'use client';

import React, { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label beside the switch (also its accessible name). Omit only with `labelledBy`. */
  label?: React.ReactNode;
  /** Id of an element that already names the switch (a table row's title). */
  labelledBy?: string;
  /** Id of help text. */
  describedBy?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * On/off for a setting that applies IMMEDIATELY (foundation-spec.md §6). In a form saved with a button, use
 * a checkbox instead (toggles.md › Desktop: "don't replace a checkbox with a switch"). The off track has a
 * field-border outline so it reads at 3:1; the hit area is 44px on touch.
 */
export function Switch({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled = false,
  id,
  className = '',
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? `switch-${autoId}`;
  const labelId = label ? `${switchId}-label` : undefined;
  return (
    <div className={`inline-flex min-h-7 items-center gap-2 pointer-coarse:min-h-11 ${className}`}>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelledBy ?? labelId}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'border-brand bg-brand' : 'border-field-border bg-surface'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block size-3.5 rounded-full shadow-card transition-transform duration-150 ${
            checked ? 'translate-x-4.5 bg-white' : 'translate-x-0.5 bg-secondary'
          }`}
        />
      </button>
      {label && (
        <label id={labelId} htmlFor={switchId} className="text-body text-primary">
          {label}
        </label>
      )}
    </div>
  );
}
