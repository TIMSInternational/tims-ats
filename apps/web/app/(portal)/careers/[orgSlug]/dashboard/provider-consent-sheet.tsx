'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { EvalSheet } from './eval-sheet';
import { CONSENT_FULL_TEXT_CLASSES } from './provider-consent-styles';

// "Leer el texto completo": the complete approved text of one consent step, alone in the PCA bottom sheet (a sheet
// rising from the bottom on phones, max 85% of the screen and scrolling; a centred 520px card from md), whose title is
// the text's own approved title (title3, never truncated). Reading only: no checkbox in here, so accepting stays on the
// step. It closes with the ✕, a click on the scrim, Escape or the full-width Close button at the end of the text, and
// focus returns to the button that opened it. The text container takes the initial focus so the keyboard scrolls it and a
// screen reader starts on the text, not on the close button.
export function ProviderConsentSheet({
  title,
  lang,
  onClose,
  children,
}: {
  /** The consent's own title, as approved: the sheet's heading. */
  title: string;
  /** The text's language when it is not the page's (a provider text served in the test's language). */
  lang?: string;
  onClose: () => void;
  /** The complete text, verbatim. */
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <EvalSheet title={title} closeLabel={t.common.close} onClose={onClose} lang={lang}>
      <div
        tabIndex={0}
        data-autofocus
        lang={lang}
        data-testid="consent-full-text"
        className={CONSENT_FULL_TEXT_CLASSES}
      >
        {children}
      </div>
    </EvalSheet>
  );
}
