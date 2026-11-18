'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import {
  AssessmentConsentNotice,
  atsNoticeAcknowledgment,
} from '../../../../../components/assessment-consent-notice';
import {
  useProviderConsentTemplates,
  type ConsentDecision,
  type ConsentTemplate,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { ProviderConsentTemplateCard } from './provider-consent-template-card';
import { ProviderOptionalConsents } from './provider-optional-consents';

const accept = (template: ConsentTemplate) => ({
  purpose: template.purpose,
  textVersion: template.textVersion,
  locale: template.locale,
});

// The consent step before a provider assessment (D16, design §2.2 "the host shows its own consent text, using a
// template served by the API"). Each purpose the provider still needs, required AND optional (English speaking: voice,
// ai_scoring), is shown in full from the provider's template, so the provider is the single source of the approved
// wording; as plain text (the API's blocks carry no markup and are rendered as text nodes only), with its own
// acceptance checkbox. "Accept and start" stays disabled until every REQUIRED text is accepted; it hands back each
// accepted purpose with the exact text_version shown, and the OPTIONAL purposes left unticked as declined
// (ProviderOptionalConsents). First comes the ATS's own short notice (AssessmentConsentNotice), which must be read
// before starting; its version and language travel with the launch, which records the acknowledgment.
export function ProviderAssessmentConsent({
  attemptId,
  busy,
  notice,
  onAccept,
  onCancel,
}: {
  attemptId: string;
  busy: boolean;
  notice: { orgName: string; vacancyTitle: string; instrumentName: string };
  onAccept: (decision: ConsentDecision) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const { data, isLoading, isError } = useProviderConsentTemplates(attemptId, locale === 'EN' ? 'en' : 'es', true);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [noticeRead, setNoticeRead] = useState(false);

  if (isLoading) return <p className="text-[12px] text-muted mt-3">{t.portalDashboard.providerConsentLoading}</p>;
  if (isError || !data || data.templates.length === 0) {
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

  const optional = new Set<string>(data.optionalPurposes);
  const required = data.templates.filter((template) => !optional.has(template.purpose));
  const offered = data.templates.filter((template) => optional.has(template.purpose));
  const allAccepted = noticeRead && required.every((template) => accepted[template.purpose] === true);
  const decide = (): ConsentDecision => ({
    accepted: data.templates.filter((template) => accepted[template.purpose] === true).map(accept),
    declined: offered.filter((template) => accepted[template.purpose] !== true).map((template) => template.purpose),
    notice: atsNoticeAcknowledgment(locale),
  });
  const toggle = (purpose: string, value: boolean) => setAccepted((current) => ({ ...current, [purpose]: value }));
  return (
    <div className="mt-3 space-y-3" aria-label={t.portalDashboard.providerConsentTitle}>
      <AssessmentConsentNotice
        orgName={notice.orgName}
        vacancyTitle={notice.vacancyTitle}
        instruments={[notice.instrumentName]}
      />
      <label className="flex items-start gap-2 text-[12px] text-[#1F114C]">
        <input type="checkbox" checked={noticeRead} onChange={(event) => setNoticeRead(event.target.checked)} />
        <span>{t.assessmentConsentNotice.readAck}</span>
      </label>
      {required.map((template) => (
        <ProviderConsentTemplateCard
          key={template.purpose}
          template={template}
          checked={accepted[template.purpose] === true}
          label={t.portalDashboard.providerConsentAccept}
          onChange={(value) => toggle(template.purpose, value)}
        />
      ))}
      <ProviderOptionalConsents templates={offered} accepted={accepted} onChange={toggle} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!allAccepted || busy}
          onClick={() => onAccept(decide())}
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
