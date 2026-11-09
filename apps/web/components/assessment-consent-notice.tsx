'use client';

import { useId } from 'react';
import { useI18n } from '../lib/i18n';

// The ATS's own notice for TIMS Assessments (design §6.3, "consent and transparency"): it names TIMS Assessments as the
// service that runs the tests on the organization's behalf, the purpose ("selection for vacancy X"), the tests, who sees
// the results, retention and the candidate's rights. The SAME text is what HR reviews when assigning and what the
// candidate reads in the portal before the provider's own per-purpose consent texts. Owner default D22: it is a draft
// pending counsel, and says so on its face. Rendered as text nodes only (names and titles are never HTML).
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
    [n.recipientsTitle, fill(n.recipients)],
    [n.retentionTitle, fill(n.retention)],
    [n.rightsTitle, fill(n.rights)],
  ];

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-[#EDEDED] p-4 space-y-2 text-[12px] text-[#585858]"
      data-testid="assessment-consent-notice"
    >
      <h3 id={titleId} className="text-[13px] font-semibold text-[#1F114C]">
        {n.title}
      </h3>
      <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-800">
        {n.draftBanner}
      </p>
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
      </div>
    </section>
  );
}
