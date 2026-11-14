'use client';

import React from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  /** A noun ("Kanban", "Lista", "Próximas"). */
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  /** Required group name ("Vista", "Periodo"). */
  label: string;
  /** Id of a visible label that names the group; used instead of `label` so it is not announced twice. */
  labelledBy?: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** Stretch the segments to the container width (forms on phones). */
  fullWidth?: boolean;
  className?: string;
}

/**
 * Switches how the same content is shown — never navigates or acts (foundation-spec.md §11,
 * segmented-controls.md: about five segments at most, noun labels). For page sections use Tabs.
 */
export function SegmentedControl<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  className = '',
}: SegmentedControlProps<T>) {
  const height = size === 'sm' ? 'h-7' : 'h-8';
  return (
    <div
      role="group"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={`${fullWidth ? 'flex w-full' : 'inline-flex'} rounded-lg bg-surface p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`${height} ${fullWidth ? 'flex-1' : ''} inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-callout font-medium text-secondary transition-colors duration-150 hover:text-primary aria-pressed:bg-white aria-pressed:text-brand aria-pressed:shadow-card pointer-coarse:min-h-11`}
        >
          {option.icon && (
            <span aria-hidden="true" className="flex size-4 items-center justify-center">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
