'use client';

import { useI18n } from '../../../../../lib/i18n';
import type { ConsentTemplate } from '../../../../../lib/platform-api/assessment-provider-portal';
import { ProviderConsentTemplateCard } from './provider-consent-template-card';

// The OPTIONAL consents of a provider assessment (English speaking: voice recording and AI scoring), shown apart from
// the required ones, each with its own checkbox, UNTICKED by default. Leaving them unticked never blocks the start: the
// speaking section is then not given and HR is told why. The wording is a draft pending counsel (D22).
export function ProviderOptionalConsents({
  templates,
  accepted,
  onChange,
}: {
  templates: ConsentTemplate[];
  accepted: Record<string, boolean>;
  onChange: (purpose: string, value: boolean) => void;
}) {
  const { t } = useI18n();
  if (templates.length === 0) return null;
  return (
    <section
      aria-labelledby="provider-optional-consents-title"
      className="space-y-3 rounded-xl border border-dashed border-[#D9D3F2] p-4"
      data-testid="provider-optional-consents"
    >
      <h3 id="provider-optional-consents-title" className="text-[13px] font-semibold text-[#1F114C]">
        {t.portalDashboard.providerOptionalTitle}
      </h3>
      <p role="note" className="rounded-lg bg-[#FFF4E5] p-2 text-[11px] font-medium text-[#8A4B00]">
        {t.portalDashboard.providerOptionalDraft}
      </p>
      <p className="text-[12px] text-[#585858]">{t.portalDashboard.providerOptionalIntro}</p>
      {templates.map((template) => (
        <ProviderConsentTemplateCard
          key={template.purpose}
          template={template}
          checked={accepted[template.purpose] === true}
          label={t.portalDashboard.providerOptionalAccept}
          onChange={(value) => onChange(template.purpose, value)}
        />
      ))}
    </section>
  );
}
