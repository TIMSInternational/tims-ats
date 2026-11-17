'use client';

import { useId, type Ref } from 'react';
import { CircleDashed, FileText } from 'lucide-react';
import { EvalButton } from './eval-button';
import { EvalCheckboxRow } from './eval-checkbox-row';
import { EvalChip } from './eval-chip';
import { EVAL_TITLE_3_CLASSES } from './eval-styles';
import {
  CONSENT_STEP_CHECK_CLASSES,
  CONSENT_STEP_CLASSES,
  CONSENT_STEP_LINE_CLASSES,
  CONSENT_STEP_READ_CLASSES,
  CONSENT_STEP_TITLE_ROW_CLASSES,
} from './provider-consent-styles';

interface ProviderConsentStepProps {
  /** The consent's own title, as approved (the provider's template title, or the ATS notice title). */
  title: string;
  /**
   * At most one neutral line under the title: navigation or instructions only ("You can read the full text before you
   * accept."). Never a summary of the text: the approved wording lives only in the full-text sheet.
   */
  line: string;
  /** The "Optional" chip beside the title; an optional step never blocks. */
  optionalLabel?: string;
  checkboxLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  readFullLabel: string;
  onReadFull: () => void;
  /** So focus can come back to "Read the full text" when the full text closes. */
  readFullRef?: Ref<HTMLButtonElement>;
  /** Language of the title when it is not the page's (a provider text served in the test's language). */
  lang?: string;
  /** Extra description for the checkbox (the id of "Tick the box to continue."). */
  describedBy?: string;
}

/**
 * One step of the candidate's consent guide in the TIMS evaluation design: the dashboard-local PCA version of the shared
 * ConsentStep (components/consent-step.tsx, which the staff dialog keeps), with the same contract: a section
 * (data-testid "consent-step", data-optional on optional steps) named by its level-3 title; the "Optional" chip; one
 * neutral line (r-lead); "Read the full text" (a compact secondary button with FileText, described by the title); and an
 * UNCHECKED checkbox in the PCA checkbox row, described by the title and, while the step waits for it, the hint.
 */
export function ProviderConsentStep({
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
}: ProviderConsentStepProps) {
  const titleId = useId();
  const checkboxDescribedBy = [titleId, describedBy].filter(Boolean).join(' ');
  return (
    <section
      aria-labelledby={titleId}
      className={CONSENT_STEP_CLASSES}
      data-testid="consent-step"
      data-optional={optionalLabel ? 'true' : undefined}
    >
      <div className={CONSENT_STEP_TITLE_ROW_CLASSES}>
        <h3 id={titleId} lang={lang} className={EVAL_TITLE_3_CLASSES}>
          {title}
        </h3>
        {optionalLabel && (
          <EvalChip tone="neutral" icon={<CircleDashed aria-hidden="true" />}>
            {optionalLabel}
          </EvalChip>
        )}
      </div>
      <p className={CONSENT_STEP_LINE_CLASSES}>{line}</p>
      <EvalButton
        ref={readFullRef}
        variant="secondary"
        size="compact"
        className={CONSENT_STEP_READ_CLASSES}
        onClick={onReadFull}
        aria-describedby={titleId}
        icon={<FileText aria-hidden="true" />}
      >
        {readFullLabel}
      </EvalButton>
      <EvalCheckboxRow
        checked={checked}
        onChange={onChange}
        describedBy={checkboxDescribedBy}
        className={CONSENT_STEP_CHECK_CLASSES}
      >
        {checkboxLabel}
      </EvalCheckboxRow>
    </section>
  );
}
