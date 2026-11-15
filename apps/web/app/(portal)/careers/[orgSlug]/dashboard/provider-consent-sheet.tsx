'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Button, Modal } from '../../../../../components';

// "Leer el texto completo": the complete approved text of one consent step, alone in a sheet that fills the phone screen
// (modality.md › Best practices: "Consider using a full-screen modal style for in-depth content"). Reading only: no
// checkbox in here, so accepting stays on the step. It closes with the header's ✕, Escape or the Close button at the
// foot of the text, and focus returns to the button that opened it. The text container takes the initial focus so the
// keyboard scrolls it and a screen reader starts on the text, not on the close button. On a phone the full-screen sheet's
// header truncates a long title to one line, so the approved title is repeated in full above the text there, like an
// iOS large title (hidden from screen readers, which already name the dialog by it); from sm the header wraps it.
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
    <Modal
      title={title}
      onClose={onClose}
      size="lg"
      fullScreenOnMobile
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.common.close}
        </Button>
      }
    >
      <p aria-hidden="true" lang={lang} className="mb-3 text-heading font-semibold text-primary sm:hidden">
        {title}
      </p>
      <div tabIndex={0} data-autofocus lang={lang} data-testid="consent-full-text" className="rounded-lg">
        {children}
      </div>
    </Modal>
  );
}
