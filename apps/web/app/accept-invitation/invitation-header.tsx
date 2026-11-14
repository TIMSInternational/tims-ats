'use client';

import { TEXT_LINK_CLASSES } from '../../components/button-styles';

/** The language switch above the invitation card; its visible name is the target language's endonym. */
export function InvitationHeader({
  language,
  languageLang,
  switchLabel,
  toggle,
}: {
  language: string;
  languageLang: 'es' | 'en';
  switchLabel: string;
  toggle: () => void;
}) {
  return (
    <div className="mb-3 flex justify-end">
      <button
        type="button"
        lang={languageLang}
        aria-label={switchLabel}
        className={`${TEXT_LINK_CLASSES} min-h-7 text-callout`}
        onClick={toggle}
      >
        {language}
      </button>
    </div>
  );
}
