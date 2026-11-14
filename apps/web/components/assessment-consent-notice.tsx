'use client';

import { useId } from 'react';
import { useI18n } from '../lib/i18n';

/**
 * The version of the ATS notice below (round 12). The C# launch accepts only this version and records it, with the
 * language it was read in, when the candidate acknowledges it (services/Tims.Platform AtsNotice.CurrentVersion; the two
 * are pinned equal by tests/assessment/ats-notice-version.test.tsx). Changing a word of `assessmentConsentNotice` means a
 * new version here AND there.
 */
export const ATS_NOTICE_VERSION = '2026-11-09-ats-notice-v1';

/** The acknowledgment the portal sends with a launch: the notice version and the language it was shown in. */
export function atsNoticeAcknowledgment(locale: string): { textVersion: string; locale: 'es' | 'en' } {
  return { textVersion: ATS_NOTICE_VERSION, locale: locale === 'EN' ? 'en' : 'es' };
}

// The ATS's own short notice for TIMS Assessments (design §6.3, consent and transparency). It states only what the ATS
// does: who receives the data (TIMS Assessments, as processor for the hiring organization), the purpose (selection for
// this vacancy), that a person decides, and how to withdraw in the portal. The provider's own per-purpose consent texts
// (the approved wording, served by the provider) follow it. The SAME text is what HR reviews when assigning and what the
// candidate reads in the portal. Rendered as text nodes only (names and titles are never HTML).
export function AssessmentConsentNotice({
  orgName,
  vacancyTitle,
  instruments,
  scroll = true,
  children,
}: {
  orgName: string;
  vacancyTitle: string;
  /** The display names of the tests, in order. */
  instruments: string[];
  /**
   * true (HR's dialog): the text sits in a bounded box that is a focusable, named region, so it scrolls from the
   * keyboard. false (the candidate portal): the text flows in the page, never clipped mid-sentence (privacy.md).
   */
  scroll?: boolean;
  /** The acknowledgment row, shown inside the notice under its text. */
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const n = t.assessmentConsentNotice;
  const titleId = useId();
  const fill = (text: string) => text.replaceAll('{org}', orgName).replaceAll('{vacancy}', vacancyTitle);
  const sections: Array<[string, string]> = [
    [n.purposeTitle, fill(n.purpose)],
    [n.decisionTitle, fill(n.decision)],
    [n.withdrawTitle, fill(n.withdraw)],
  ];
  const body = (
    <>
      <p>{fill(n.intro)}</p>
      <h4 className="text-subheading font-semibold text-primary">{n.testsTitle}</h4>
      <ul className="list-disc pl-5">
        {instruments.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {sections.map(([heading, text]) => (
        <div key={heading}>
          <h4 className="text-subheading font-semibold text-primary">{heading}</h4>
          <p>{text}</p>
        </div>
      ))}
      <p>{n.providerConsents}</p>
      <p className="text-caption text-secondary">{n.versionLabel.replace('{version}', ATS_NOTICE_VERSION)}</p>
    </>
  );

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-xl border border-border p-4"
      data-testid="assessment-consent-notice"
      data-notice-version={ATS_NOTICE_VERSION}
    >
      <h3 id={titleId} className="text-subheading font-semibold text-brand">
        {n.title}
      </h3>
      {scroll ? (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby={titleId}
          className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border-subtle p-3 text-body leading-relaxed text-secondary"
        >
          {body}
        </div>
      ) : (
        <div className="max-w-prose space-y-2 text-body leading-relaxed text-primary">{body}</div>
      )}
      {children}
    </section>
  );
}
