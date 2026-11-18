'use client';

import { useId, type Ref } from 'react';
import { Button } from './button';
import { StatusBadge } from './status-badge';
import { CHOICE_INPUT_CLASSES } from './field-styles';

interface ConsentStepProps {
  /** The consent's own title, as approved (the provider's template title, or the ATS notice title). */
  title: string;
  /**
   * At most one neutral line under the title: navigation or instructions only ("Puede leer el texto completo antes de
   * aceptar"). Never a summary of the text: the approved wording lives only in the full-text view.
   */
  line: string;
  /** The "Opcional" chip beside the title; an optional step never blocks. */
  optionalLabel?: string;
  checkboxLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  readFullLabel: string;
  onReadFull: () => void;
  /** So focus can come back to "Leer el texto completo" when the full text closes. */
  readFullRef?: Ref<HTMLButtonElement>;
  /** Language of the title when it is not the page's (a provider text served in the test's language). */
  lang?: string;
  /** Extra description for the checkbox (e.g. the id of "Marque la casilla para continuar"). */
  describedBy?: string;
}

/**
 * One step of a consent guide (round 3 owner direction): the consent's title, one neutral line, a button that opens the
 * complete approved text, and an UNCHECKED checkbox to accept it. Progressive disclosure keeps the step short while the
 * full text stays one press away (layout.md › Visual hierarchy: "Use progressive disclosure to make layouts cleaner"). A
 * checkbox, not a switch, states a single on/off choice (toggles.md › Radio buttons: "To present a single setting that can
 * be on or off, prefer a checkbox"). The whole row is the label, at least 44px tall on touch.
 */
export function ConsentStep({
  title,
  line,
  optionalLabel,
  checkboxLabel,
  checked,
  onChange,
  readFullLabel,
  onReadFull,
  readFullRef,
  lang,
  describedBy,
}: ConsentStepProps) {
  const titleId = useId();
  const checkboxDescribedBy = [titleId, describedBy].filter(Boolean).join(' ');
  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3"
      data-testid="consent-step"
      data-optional={optionalLabel ? 'true' : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} lang={lang} className="text-subheading font-semibold text-primary">
          {title}
        </h3>
        {optionalLabel && (
          <StatusBadge tone="neutral" icon="none">
            {optionalLabel}
          </StatusBadge>
        )}
      </div>
      <p className="max-w-prose text-base text-secondary sm:text-body">{line}</p>
      <Button
        ref={readFullRef}
        variant="secondary"
        onClick={onReadFull}
        aria-describedby={titleId}
        icon={
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
            />
          </svg>
        }
      >
        {readFullLabel}
      </Button>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-field-border bg-white p-3 text-base font-medium text-primary transition-colors hover:bg-surface-hover has-[:checked]:border-brand has-[:checked]:bg-brand-tint sm:text-body">
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={checkboxDescribedBy}
          onChange={(event) => onChange(event.target.checked)}
          className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
        />
        <span>{checkboxLabel}</span>
      </label>
    </section>
  );
}
