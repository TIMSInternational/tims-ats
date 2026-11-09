'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import {
  useProviderConsentTemplates,
  type AcceptedConsent,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { ProviderConsentTemplateCard } from './provider-consent-template-card';

// The consent step before a provider assessment (D16, design §2.2 "the host shows its own consent text, using a
// template served by the API"). Each purpose the provider still needs is shown in full, as plain text (the API's
// blocks carry no markup and are rendered as text nodes only), with its own acceptance checkbox. "Accept and start"
// stays disabled until every text is accepted; it hands back each purpose with the exact text_version shown.
export function ProviderAssessmentConsent({
  attemptId,
  busy,
  onAccept,
  onCancel,
}: {
  attemptId: string;
  busy: boolean;
  onAccept: (consents: AcceptedConsent[]) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const { data, isLoading, isError } = useProviderConsentTemplates(attemptId, locale === 'EN' ? 'en' : 'es', true);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  if (isLoading) return <p className="text-[12px] text-muted mt-3">{t.portalDashboard.providerConsentLoading}</p>;
  if (isError || !data || data.length === 0) {
    return (
      <div className="mt-3">
        <p role="alert" className="text-[12px] text-[#B42318]">
          {t.portalDashboard.providerConsentError}
        </p>
        <button type="button" onClick={onCancel} className="mt-2 text-[12px] text-[#1F114C] underline">
          {t.portalDashboard.providerCancel}
        </button>
      </div>
    );
  }

  const allAccepted = data.every((template) => accepted[template.purpose] === true);
  return (
    <div className="mt-3 space-y-3" aria-label={t.portalDashboard.providerConsentTitle}>
      {data.map((template) => (
        <ProviderConsentTemplateCard
          key={template.purpose}
          template={template}
          checked={accepted[template.purpose] === true}
          label={t.portalDashboard.providerConsentAccept}
          onChange={(value) => setAccepted((current) => ({ ...current, [template.purpose]: value }))}
        />
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!allAccepted || busy}
          onClick={() =>
            onAccept(
              data.map((template) => ({
                purpose: template.purpose,
                textVersion: template.textVersion,
                locale: template.locale,
              })),
            )
          }
          className="inline-flex h-9 items-center rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] transition disabled:opacity-50"
        >
          {busy ? t.portalDashboard.providerOpening : t.portalDashboard.providerAcceptAndStart}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-xl border border-[#EDEDED] px-4 text-[12px] font-medium text-[#1F114C]"
        >
          {t.portalDashboard.providerCancel}
        </button>
      </div>
    </div>
  );
}
