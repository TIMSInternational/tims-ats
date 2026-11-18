'use client';

import type { ReactNode } from 'react';
import { CHOICE_INPUT_CLASSES } from '../../../../components';

// One on/off setting of a saved form, as a checkbox row: what it is, what happens when it is on, and (optionally) why
// it is unavailable. A checkbox, not a switch, because nothing applies until "Guardar cambios" (foundation §6,
// toggles.md: a switch implies the change takes effect at once). The whole row is the label: a 44px target on touch.
export function SettingSwitch({
  id,
  label,
  help,
  checked,
  disabled = false,
  onChange,
  children,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
}) {
  const helpId = `${id}-help`;
  const labelId = `${id}-label`;
  return (
    <div className="border-b border-border py-4 last:border-0">
      <label
        htmlFor={id}
        className={`flex min-h-7 items-start gap-3 pointer-coarse:min-h-11 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          id={id}
          type="checkbox"
          aria-labelledby={labelId}
          aria-describedby={helpId}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className={`${CHOICE_INPUT_CLASSES} mt-0.5 disabled:cursor-not-allowed`}
        />
        <span className="min-w-0">
          <span
            id={labelId}
            className={`block text-subheading font-medium ${disabled ? 'text-secondary' : 'text-primary'}`}
          >
            {label}
          </span>
          <span id={helpId} className="mt-1 block text-callout leading-relaxed text-secondary">
            {help}
          </span>
        </span>
      </label>
      {children && <div className="pl-7">{children}</div>}
    </div>
  );
}
