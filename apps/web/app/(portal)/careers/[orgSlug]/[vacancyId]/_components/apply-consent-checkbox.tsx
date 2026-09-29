'use client';

import { useI18n } from '../../../../../../lib/i18n';

interface ApplyConsentCheckboxProps {
  companyName: string;
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
  companyName,
  privacyHref,
  checked,
  onChange,
  disabled,
}: ApplyConsentCheckboxProps) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-describedby={checked ? undefined : 'apply-consent-hint'}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#EDEDED] accent-[#DD0C15]"
        />
        <span className="text-[12px] leading-relaxed text-[#585858]">
          {p.consentCheckboxPrefix} <span className="font-medium text-[#333]">{companyName}</span>{' '}
          {p.consentCheckboxMiddle}{' '}
          <a
            href={privacyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#1F114C] underline hover:text-[#DD0C15]"
          >
            {p.consentPolicyLink}
          </a>
          {p.consentCheckboxSuffix}
        </span>
      </label>
      {!checked && (
        <p id="apply-consent-hint" className="mt-1.5 pl-6 text-[11px] text-[#8B8B8B]">
          {p.consentRequiredHint}
        </p>
      )}
    </div>
  );
}
