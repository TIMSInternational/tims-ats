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
}

/**
 * Progress through a multi-step flow. Done steps show a check, the current one is navy with
 * aria-current="step". Below sm only "Paso n de m" and the current label are shown.
 */
export function Stepper({ steps, current, label, className = '' }: StepperProps) {
  const { t } = useI18n();
  const position = formatMessage(t.common.stepOf, { current: current + 1, total: steps.length });
  return (
    <nav aria-label={label ?? t.common.steps} className={className}>
      <p className="text-callout text-secondary sm:hidden">
        <span className="font-semibold text-brand">{position}</span>
        {steps[current] ? ` · ${steps[current]}` : ''}
      </p>
      <ol className="hidden items-center gap-2 sm:flex">
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
                className={`truncate text-callout ${active ? 'font-semibold text-brand' : done ? 'text-primary' : 'text-secondary'}`}
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
