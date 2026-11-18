'use client';

import { ACTIVE_APPLICATION_CONSENT_VARIANT, type ApplicationConsentVariant } from '@tims/shared';
import { useI18n } from '../../../../../../lib/i18n';
import { CHOICE_INPUT_CLASSES } from '../../../../../../components/field-styles';

interface ApplyConsentCheckboxProps {
  // The organization (data controller) — see ApplyModal's controllerName.
  controllerName: string;
  privacyHref: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
  /** Which versioned wording to show; defaults to the deployment's (the version the apply endpoint accepts). */
  variant?: ApplicationConsentVariant;
}

// Explicit data-processing authorization (Colombia Ley 1581: prior, express, informed).
// Unchecked by default; names the organization and the purpose, and links the policy.
// The wording is versioned by APPLICATION_CONSENT_TEXT_VERSION (@tims/shared) — bump it
// when these i18n strings change materially. The Ley N.° 8968 variant (`portalLey8968Consent.*`)
// is shown only when ACTIVE_APPLICATION_CONSENT_VARIANT is 'ley8968' (off by default).
export function ApplyConsentCheckbox({
  controllerName,
  privacyHref,
  checked,
  onChange,
  disabled,
  variant = ACTIVE_APPLICATION_CONSENT_VARIANT,
}: ApplyConsentCheckboxProps) {
  const { t } = useI18n();
  const p = t.portal;
  const text =
    variant === 'ley8968'
      ? t.portalLey8968Consent
      : {
          prefix: p.consentCheckboxPrefix,
          middle: p.consentCheckboxMiddle,
          policyLink: p.consentPolicyLink,
          suffix: p.consentCheckboxSuffix,
        };

  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2.5 pointer-coarse:min-h-11">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-describedby={checked ? undefined : 'apply-consent-hint'}
          className={`mt-0.5 ${CHOICE_INPUT_CLASSES}`}
        />
        <span className="text-callout leading-relaxed text-secondary">
          {text.prefix} <span className="font-medium text-primary">{controllerName}</span> {text.middle}{' '}
          <a
            href={privacyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline hover:text-brand-hover"
          >
            {text.policyLink}
          </a>
          {text.suffix}
        </span>
      </label>
      {!checked && (
        <p id="apply-consent-hint" className="mt-1.5 pl-6 text-caption text-secondary">
          {p.consentRequiredHint}
        </p>
      )}
    </div>
  );
}
