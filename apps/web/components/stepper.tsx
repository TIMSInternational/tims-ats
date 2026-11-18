'use client';

import { formatMessage, useI18n } from '../lib/i18n';

interface StepperProps {
  /** Step labels, already translated ("Datos", "Documentos", "Revisión"). */
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
  /** Accessible name; defaults to t.common.steps. */
  label?: string;
  className?: string;
  /**
   * 'compact' shows only the numbered steps plus one line "Paso n de m · current label" at every width, for flows
   * whose labels are long or whose container is narrow (labels must never be truncated: layout.md › Best practices).
   */
  variant?: 'labels' | 'compact';
}

/**
 * Progress through a multi-step flow. Done steps show a check, the current one is navy with
 * aria-current="step". Below sm only "Paso n de m" and the current label are shown.
 */
// Layout classes per variant (constants, so the i18n scanner never reads a class list as copy).
const LIST_CLASSES = { labels: 'hidden sm:flex', compact: 'flex' } as const;
const LINE_CLASSES = { labels: 'sm:hidden', compact: 'order-last mt-2' } as const;
const LABEL_CLASSES = { labels: 'truncate', compact: 'sr-only' } as const;
const NAV_CLASSES = { labels: '', compact: 'flex flex-col' } as const;

export function Stepper({ steps, current, label, className = '', variant = 'labels' }: StepperProps) {
  const { t } = useI18n();
  const position = formatMessage(t.common.stepOf, { current: current + 1, total: steps.length });
  return (
    <nav aria-label={label ?? t.common.steps} className={`${NAV_CLASSES[variant]} ${className}`}>
      <p className={`text-callout text-secondary ${LINE_CLASSES[variant]}`}>
        <span className="font-semibold text-brand">{position}</span>
        {steps[current] ? ` · ${steps[current]}` : ''}
      </p>
      <ol className={`items-center gap-2 ${LIST_CLASSES[variant]}`}>
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step} aria-current={active ? 'step' : undefined} className="flex min-w-0 items-center gap-2">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={`h-px w-6 shrink-0 ${done || active ? 'bg-brand' : 'bg-field-border'}`}
                />
              )}
              <span
                aria-hidden="true"
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold ${
                  done
                    ? 'bg-brand text-white'
                    : active
                      ? 'border-2 border-brand text-brand'
                      : 'border border-field-border text-secondary'
                }`}
              >
                {done ? (
                  <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={`${LABEL_CLASSES[variant]} text-callout ${active ? 'font-semibold text-brand' : done ? 'text-primary' : 'text-secondary'}`}
              >
                {step}
                {done && <span className="sr-only"> ({t.common.stepDone})</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
