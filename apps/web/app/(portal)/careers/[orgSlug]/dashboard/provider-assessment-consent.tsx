'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { AssessmentConsentNotice, atsNoticeAcknowledgment } from '../../../../../components/assessment-consent-notice';
import {
  useProviderConsentTemplates,
  type ConsentDecision,
  type ConsentTemplate,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { BUTTON_GROUP_CLASSES, Button, CHOICE_INPUT_CLASSES, ErrorState, Skeleton } from '../../../../../components';
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
  const { data, isLoading, isError, refetch } = useProviderConsentTemplates(
    attemptId,
    locale === 'EN' ? 'en' : 'es',
    true,
  );
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [noticeRead, setNoticeRead] = useState(false);

  if (isLoading)
    return (
      <div aria-busy="true" className="mt-3 space-y-2">
        <span className="sr-only">{t.portalDashboard.providerConsentLoading}</span>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  if (isError || !data || data.templates.length === 0) {
    // A network blip must not be a dead end: retry the read, or step back out.
    return (
      <div className="mt-3 space-y-2">
        <ErrorState
          size="compact"
          title={t.portalDashboard.providerConsentError}
          onRetry={isError ? () => void refetch() : undefined}
        />
        <Button variant="tertiary" size="sm" onClick={onCancel}>
          {t.portalDashboard.providerCancel}
        </Button>
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
    <div className="mt-3 space-y-3" role="group" aria-label={t.portalDashboard.providerConsentTitle}>
      <AssessmentConsentNotice
        orgName={notice.orgName}
        vacancyTitle={notice.vacancyTitle}
        instruments={[notice.instrumentName]}
        scroll={false}
      >
        <label className="mt-1 flex min-h-7 cursor-pointer items-start gap-2 border-t border-border pt-3 text-body font-medium text-primary pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={noticeRead}
            onChange={(event) => setNoticeRead(event.target.checked)}
            className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
          />
          <span>{t.assessmentConsentNotice.readAck}</span>
        </label>
      </AssessmentConsentNotice>
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
      <div className={BUTTON_GROUP_CLASSES}>
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
          {t.portalDashboard.providerCancel}
        </Button>
        <Button
          size="lg"
          disabled={!allAccepted}
          loading={busy}
          loadingLabel={t.portalDashboard.providerOpening}
          onClick={() => onAccept(decide())}
        >
          {t.portalDashboard.providerAcceptAndStart}
        </Button>
      </div>
    </div>
  );
}
