'use client';

import React from 'react';

/** Status tones (foundation-spec.md §12). Every pair passes 4.5:1 at 11px. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-surface text-secondary',
  info: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  brand: 'bg-brand-tint text-brand',
};

const BASE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold';

function OutcomeIcon({ tone }: { tone: StatusTone }) {
  const cls = 'size-3 shrink-0';
  if (tone === 'success') {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'danger') {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7v6m0 4h.01" strokeLinecap="round" />
      </svg>
    );
  }
  // Neutral, info and brand states (stages, "Borrador") get a small dot in the text colour.
  return <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />;
}

export interface StatusMapEntry {
  /** Legacy free-form classes. Prefer `tone`. */
  cls?: string;
  tone?: StatusTone;
  label: string;
  /** A glyph that says what the state is beyond its tone (aria-hidden, size-3), e.g. a pause for "Congelada". */
  icon?: React.ReactNode;
}

interface StatusBadgeProps {
  /** New API: the tone, with the word as children (or `label`). */
  tone?: StatusTone;
  label?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Leading mark: 'auto' (default) = check / ! / x for success / warning / danger and a dot otherwise;
   * 'none' hides it; or pass your own icon (aria-hidden, size-3), e.g. a clock for "Plazo vencido".
   */
  icon?: 'auto' | 'none' | React.ReactNode;
  className?: string;
  /** Legacy API: look `status` up in `map`. Unknown statuses fall back to the neutral tone. */
  status?: string;
  map?: Record<string, StatusMapEntry>;
}

/** A status chip: always a word, never colour alone (accessibility.md › Vision). */
export function StatusBadge({ tone, label, children, icon = 'auto', className = '', status, map }: StatusBadgeProps) {
  if (map !== undefined || status !== undefined) {
    const entry = (map && status ? map[status.toLowerCase()] : undefined) ?? {
      tone: 'neutral' as const,
      label: status ?? '',
    };
    const legacyTone = entry.tone ?? (entry.cls ? undefined : 'neutral');
    const colour = legacyTone ? STATUS_TONE_CLASSES[legacyTone] : entry.cls;
    return (
      <span className={`${BASE} ${colour} ${className}`}>
        {icon === 'auto' && (entry.icon ?? (legacyTone && <OutcomeIcon tone={legacyTone} />))}
        {icon !== 'auto' && icon !== 'none' && icon}
        {entry.label}
      </span>
    );
  }

  const resolved: StatusTone = tone ?? 'neutral';
  return (
    <span className={`${BASE} ${STATUS_TONE_CLASSES[resolved]} ${className}`}>
      {icon === 'auto' ? <OutcomeIcon tone={resolved} /> : icon === 'none' ? null : icon}
      {children ?? label}
    </span>
  );
}
