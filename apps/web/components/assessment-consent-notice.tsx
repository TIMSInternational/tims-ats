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
// candidate reads in the portal: both now reach it through "Leer el texto completo" in a consent guide, where it is shown
// whole, in the page's flow (never a clipped scroll box). Rendered as text nodes only (names and titles are never HTML).
export function AssessmentConsentNotice({
  orgName,
  vacancyTitle,
  instruments,
  titled = true,
}: {
  orgName: string;
  vacancyTitle: string;
  /** The display names of the tests, in order. */
  instruments: string[];
  /**
   * true (HR's dialog): the notice shows its own title. false (the candidate's full-text sheet): the sheet's heading is
   * already the notice title, so the notice starts at its first paragraph and its section headings move up one level.
   */
  titled?: boolean;
}) {
  const { t } = useI18n();
  const n = t.assessmentConsentNotice;
  const titleId = useId();
  const Section = titled ? 'h4' : 'h3';
  const fill = (text: string) => text.replaceAll('{org}', orgName).replaceAll('{vacancy}', vacancyTitle);
  const sections: Array<[string, string]> = [
    [n.purposeTitle, fill(n.purpose)],
    [n.decisionTitle, fill(n.decision)],
    [n.withdrawTitle, fill(n.withdraw)],
  ];
  return (
    <section
      aria-labelledby={titled ? titleId : undefined}
      className="max-w-prose space-y-2 text-base leading-relaxed text-primary sm:text-body"
      data-testid="assessment-consent-notice"
      data-notice-version={ATS_NOTICE_VERSION}
    >
      {titled && (
        <h3 id={titleId} className="text-subheading font-semibold text-brand">
          {n.title}
        </h3>
      )}
      <p>{fill(n.intro)}</p>
      <Section className="text-subheading font-semibold text-primary">{n.testsTitle}</Section>
      <ul className="list-disc pl-5">
        {instruments.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {sections.map(([heading, text]) => (
        <div key={heading}>
          <Section className="text-subheading font-semibold text-primary">{heading}</Section>
          <p>{text}</p>
        </div>
      ))}
      <p>{n.providerConsents}</p>
      <p className="text-caption text-secondary">{n.versionLabel.replace('{version}', ATS_NOTICE_VERSION)}</p>
    </section>
  );
}
