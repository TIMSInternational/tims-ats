'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useI18n } from '../../../../../../lib/i18n';

const STARS = [1, 2, 3, 4, 5] as const;

interface StarRatingProps {
  /** Accessible name of the group, e.g. the competency label. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * 1–5 rating as an ARIA radio group: one tab stop (roving tabindex), arrow
 * keys / Home / End move and select, Space / Enter / click select.
 */
export function StarRating({ label, value, onChange, disabled = false }: StarRatingProps) {
  const { t } = useI18n();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // A stored rating may be fractional (the API accepts any 1..5 number): the radio
  // group selects and focuses the nearest whole star.
  const selected = value >= 1 && value <= 5 ? Math.round(value) : 0;
  const focusable = selected || 1;

  const select = (star: number) => {
    if (disabled) return;
    onChange(star);
    refs.current[star - 1]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, star: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(5, star + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(1, star - 1);
    else if (event.key === 'Home') next = 1;
    else if (event.key === 'End') next = 5;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className="flex gap-0.5">
      {STARS.map((star) => {
        const filled = star <= value;
        return (
          <button
            key={star}
            ref={(el) => {
              refs.current[star - 1] = el;
            }}
            type="button"
            role="radio"
            aria-checked={star === selected}
            aria-label={t.interviewRoom.starLabel.replace('{n}', String(star))}
            tabIndex={star === focusable ? 0 : -1}
            disabled={disabled}
            onClick={() => select(star)}
            onKeyDown={(e) => onKeyDown(e, star)}
            className="p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C] focus-visible:ring-offset-1 disabled:cursor-not-allowed"
          >
            <svg
              aria-hidden="true"
              className={`w-4 h-4 transition-colors ${filled ? 'text-amber-400' : 'text-[#D4D4D4] hover:text-amber-300'}`}
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
