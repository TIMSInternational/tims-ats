'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { CHOICE_INPUT_CLASSES } from '../../../../../../components/field-styles';

interface ApplyConsentCheckboxProps {
  // The organization (data controller) — see ApplyModal's controllerName.
  controllerName: string;
  privacyHref: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}

// Explicit data-processing authorization (Colombia Ley 1581: prior, express, informed).
// Unchecked by default; names the organization and the purpose, and links the policy.
// The wording is versioned by APPLICATION_CONSENT_TEXT_VERSION (@tims/shared) — bump it
// when these i18n strings change materially.
export function ApplyConsentCheckbox({
  controllerName,
  privacyHref,
  checked,
  onChange,
  disabled,
}: ApplyConsentCheckboxProps) {
  const { t } = useI18n();
  const p = t.portal;

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
          {p.consentCheckboxPrefix} <span className="font-medium text-primary">{controllerName}</span>{' '}
          {p.consentCheckboxMiddle}{' '}
          <a
            href={privacyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline hover:text-brand-hover"
          >
            {p.consentPolicyLink}
          </a>
          {p.consentCheckboxSuffix}
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
