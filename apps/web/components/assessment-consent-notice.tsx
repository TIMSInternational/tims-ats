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
}: {
  orgName: string;
  vacancyTitle: string;
  /** The display names of the tests, in order. */
  instruments: string[];
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

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-[#EDEDED] p-4 space-y-2 text-[12px] text-[#585858]"
      data-testid="assessment-consent-notice"
      data-notice-version={ATS_NOTICE_VERSION}
    >
      <h3 id={titleId} className="text-[13px] font-semibold text-[#1F114C]">
        {n.title}
      </h3>
      <div className="max-h-64 overflow-y-auto space-y-2">
        <p>{fill(n.intro)}</p>
        <h4 className="font-semibold text-[#1F114C]">{n.testsTitle}</h4>
        <ul className="list-disc pl-5">
          {instruments.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        {sections.map(([heading, text]) => (
          <div key={heading}>
            <h4 className="font-semibold text-[#1F114C]">{heading}</h4>
            <p>{text}</p>
          </div>
        ))}
        <p>{n.providerConsents}</p>
        <p className="text-[11px] text-muted">{n.versionLabel.replace('{version}', ATS_NOTICE_VERSION)}</p>
      </div>
    </section>
  );
}
