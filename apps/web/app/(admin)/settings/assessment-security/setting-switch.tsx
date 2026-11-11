'use client';

import type { ReactNode } from 'react';

// One on/off setting, as a labelled switch: what it is, what happens when it is on, and (optionally) why it is
// unavailable. The control is a native checkbox with role="switch", so keyboard, screen readers and forms just work.
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
  return (
    <div className="py-4 border-b border-[#F3F3F3] last:border-0">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <label htmlFor={id} className={`text-sm font-medium ${disabled ? 'text-[#8B8B8B]' : 'text-[#1F114C]'}`}>
            {label}
          </label>
          <p id={helpId} className="mt-1 text-[12px] leading-relaxed text-[#585858]">
            {help}
          </p>
        </div>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            id={id}
            type="checkbox"
            role="switch"
            aria-checked={checked}
            aria-describedby={helpId}
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="peer h-6 w-11 cursor-pointer appearance-none rounded-full bg-[#D9D9D9] transition-colors checked:bg-[#1F114C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F114C] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
          />
        </span>
      </div>
      {children}
    </div>
  );
}
