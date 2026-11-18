import React from 'react';

/** The "Congelada" status mark: a pause, so a frozen vacancy reads as paused, not as a generic info state. */
export function PauseGlyph() {
  return (
    <svg className="size-3 shrink-0" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="2" width="2.5" height="8" rx="0.5" />
      <rect x="7" y="2" width="2.5" height="8" rx="0.5" />
    </svg>
  );
}
