'use client';

import { useId, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { useI18n } from '../../../../../lib/i18n';
import { EvalChip } from './eval-chip';
import {
  EVAL_STEP_LABEL_CLASSES,
  EVAL_STEP_MARKER_CLASSES,
  EVAL_STEP_MARKER_STATES,
  EVAL_STEP_ROW_CLASSES,
} from './eval-control-styles';
import { EVAL_TITLE_3_CLASSES } from './eval-styles';
import type { ConsentGuideItem } from './provider-consent-guide';
import {
  CONSENT_REVIEW_CLASSES,
  CONSENT_REVIEW_LINE_CLASSES,
  CONSENT_REVIEW_LIST_CLASSES,
  CONSENT_REVIEW_OPTIONAL_CLASSES,
  CONSENT_REVIEW_OPTIONAL_INTRO_CLASSES,
  CONSENT_REVIEW_OPTIONAL_LIST_CLASSES,
  CONSENT_REVIEW_OPTIONAL_TITLE_CLASSES,
} from './provider-consent-styles';

/** A review row is done (the box was ticked) or todo (left unticked); the StepList's "now" marker is not used here. */
type ReviewMark = 'done' | 'todo';
/** The marker's icon and the chip's, per choice: a check for a ticked box, a dash for one left unticked. */
const MARK: Record<ReviewMark, ReactNode> = {
  done: <Check aria-hidden="true" strokeWidth={2.5} />,
  todo: <Minus aria-hidden="true" strokeWidth={2.5} />,
};

// The last step of the consent guide ("Empezar"), as a PCA StepList: each text by its own title with what the candidate
// chose, so the choice can be checked, and changed with Back, before anything is recorded. A ticked box is an ok marker
// with a check and an ok chip ("Leído", "Aceptado"); one left unticked a soft marker and a neutral chip ("No aceptado").
// The state is a word with an icon, never a colour alone (accessibility.md › Vision: "Convey information with more than
// color alone"). The optional consents sit under their own heading with the portal's existing explanation of what leaving
// them unticked means.
export function ProviderConsentReview({
  items,
  checked,
}: {
  items: ConsentGuideItem[];
  checked: Record<string, boolean>;
}) {
  const { t } = useI18n();
  const m = t.portalDashboard;
  const titleId = useId();
  const optionalId = useId();
  const required = items.filter((item) => !item.optional);
  const optional = items.filter((item) => item.optional);
  const row = (item: ConsentGuideItem) => {
    const state: ReviewMark = checked[item.key] === true ? 'done' : 'todo';
    return (
      <li key={item.key} className={EVAL_STEP_ROW_CLASSES}>
        <span aria-hidden="true" className={`${EVAL_STEP_MARKER_CLASSES} ${EVAL_STEP_MARKER_STATES[state]}`}>
          {MARK[state]}
        </span>
        <span lang={item.lang} className={EVAL_STEP_LABEL_CLASSES}>
          {item.title}
        </span>
        <EvalChip tone={state === 'done' ? 'ok' : 'neutral'} icon={MARK[state]}>
          {state === 'done' ? item.checkedLabel : m.providerGuideNotAccepted}
        </EvalChip>
      </li>
    );
  };
  return (
    <section aria-labelledby={titleId} className={CONSENT_REVIEW_CLASSES} data-testid="consent-review">
      <h3 id={titleId} className={EVAL_TITLE_3_CLASSES}>
        {m.providerGuideReviewTitle}
      </h3>
      <p className={CONSENT_REVIEW_LINE_CLASSES}>{m.providerGuideReviewLine}</p>
      <ul className={CONSENT_REVIEW_LIST_CLASSES}>{required.map(row)}</ul>
      {optional.length > 0 && (
        <section aria-labelledby={optionalId} className={CONSENT_REVIEW_OPTIONAL_CLASSES}>
          <h4 id={optionalId} className={CONSENT_REVIEW_OPTIONAL_TITLE_CLASSES}>
            {m.providerOptionalTitle}
          </h4>
          <ul className={CONSENT_REVIEW_OPTIONAL_LIST_CLASSES}>{optional.map(row)}</ul>
          <p className={CONSENT_REVIEW_OPTIONAL_INTRO_CLASSES}>{m.providerOptionalIntro}</p>
        </section>
      )}
    </section>
  );
}
