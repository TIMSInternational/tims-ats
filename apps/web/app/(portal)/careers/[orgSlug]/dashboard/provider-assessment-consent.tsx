'use client';

import { useI18n } from '../../../../../lib/i18n';
import { atsNoticeAcknowledgment } from '../../../../../components/assessment-consent-notice';
import {
  useProviderConsentTemplates,
  type ConsentDecision,
  type ConsentTemplate,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { Button, ErrorState, Skeleton } from '../../../../../components';
import { ProviderConsentGuide, type ConsentGuideItem } from './provider-consent-guide';
import { ProviderConsentText } from './provider-consent-text';
import { noticeGuideItem } from './provider-notice-guide-item';

const accept = (template: ConsentTemplate) => ({
  purpose: template.purpose,
  textVersion: template.textVersion,
  locale: template.locale,
});

/**
 * What the launch records, from what was ticked: each accepted text with the exact text_version shown, in the order the
 * provider served them; every OPTIONAL purpose left unticked as declined; and the ATS notice acknowledgment. The same
 * decision, for the same choices, as before the step-by-step guide (pinned by tests/portal/provider-consent-guide.test.tsx).
 */
export function consentDecision(
  templates: ConsentTemplate[],
  optionalPurposes: readonly string[],
  checked: Record<string, boolean>,
  locale: string,
): ConsentDecision {
  const optional = new Set<string>(optionalPurposes);
  return {
    accepted: templates.filter((template) => checked[template.purpose] === true).map(accept),
    declined: templates
      .filter((template) => optional.has(template.purpose) && checked[template.purpose] !== true)
      .map((template) => template.purpose),
    notice: atsNoticeAcknowledgment(locale),
  };
}

// The consent step before a provider assessment (D16, design §2.2 "the host shows its own consent text, using a
// template served by the API"), as a step-by-step guide: first the ATS's own notice (AssessmentConsentNotice), then each
// purpose the provider still needs, required first, then the OPTIONAL ones (English speaking: voice, ai_scoring), then
// "Empezar". Each step opens the provider's template in full, as served and as plain text, so the provider stays the
// single source of the approved wording. "Aceptar y comenzar" stays disabled until the notice and every REQUIRED text
// are ticked; nothing is pre-ticked; optional texts never block.
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
  const m = t.portalDashboard;
  const { data, isLoading, isError, refetch } = useProviderConsentTemplates(
    attemptId,
    locale === 'EN' ? 'en' : 'es',
    true,
  );

  if (isLoading)
    return (
      <div aria-busy="true" className="mt-3 space-y-2">
        <span className="sr-only">{m.providerConsentLoading}</span>
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
          title={m.providerConsentError}
          onRetry={isError ? () => void refetch() : undefined}
        />
        <Button variant="tertiary" size="sm" onClick={onCancel}>
          {m.providerCancel}
        </Button>
      </div>
    );
  }

  const optional = new Set<string>(data.optionalPurposes);
  const step = (template: ConsentTemplate, isOptional: boolean): ConsentGuideItem => {
    const title = template.title || m.providerConsentTitle;
    return {
      key: template.purpose,
      stepLabel: title,
      title,
      line: isOptional ? m.providerGuideOptionalLine : m.providerGuideConsentLine,
      checkboxLabel: isOptional ? m.providerOptionalAccept : m.providerConsentAccept,
      checkedLabel: m.providerGuideAccepted,
      optional: isOptional,
      lang: template.locale,
      fullText: <ProviderConsentText template={template} />,
    };
  };
  const items: ConsentGuideItem[] = [
    noticeGuideItem(t, notice),
    ...data.templates.filter((template) => !optional.has(template.purpose)).map((template) => step(template, false)),
    ...data.templates.filter((template) => optional.has(template.purpose)).map((template) => step(template, true)),
  ];
  return (
    <ProviderConsentGuide
      items={items}
      review
      finishLabel={m.providerAcceptAndStart}
      busy={busy}
      onFinish={(checked) => onAccept(consentDecision(data.templates, data.optionalPurposes, checked, locale))}
      onCancel={onCancel}
    />
  );
}
