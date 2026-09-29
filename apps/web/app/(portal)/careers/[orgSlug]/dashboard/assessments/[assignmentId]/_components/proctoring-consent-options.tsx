'use client';

import { useI18n } from '../../../../../../../../lib/i18n';

interface ProctoringConsentOptionsProps {
  mediaEvidenceAvailable: boolean;
  mediaEvidenceUnavailableDuration: boolean;
  mediaEvidenceOptIn: boolean;
  assessmentConsent: boolean;
  disabled: boolean;
  onMediaOptInChange: (accepted: boolean) => void;
  onAssessmentConsentChange: (accepted: boolean) => void;
}

export function ProctoringConsentOptions({
  mediaEvidenceAvailable, mediaEvidenceUnavailableDuration, mediaEvidenceOptIn,
  assessmentConsent, disabled, onMediaOptInChange, onAssessmentConsentChange,
}: ProctoringConsentOptionsProps) {
  const { t } = useI18n();
  const copy = t.proctoring.candidate;
  return (
    <>
      <p className="rounded-xl bg-[#F4F1FA] p-3 text-[12px] text-[#493478] leading-relaxed">
        {mediaEvidenceAvailable ? copy.privacyWithMedia : copy.privacy}
      </p>
      {mediaEvidenceUnavailableDuration && (
        <p className="rounded-xl border border-[#E7DCC8] bg-[#FFFBF4] p-3 text-[12px] text-[#6F4B12]" role="status">
          {copy.mediaEvidenceDurationUnavailable}
        </p>
      )}
      {mediaEvidenceAvailable && (
        <label className="flex items-start gap-3 rounded-xl border border-[#DCD4EC] p-3 text-[13px] text-[#444]">
          <input type="checkbox" checked={mediaEvidenceOptIn}
            onChange={(event) => onMediaOptInChange(event.target.checked)} disabled={disabled}
            className="mt-0.5 h-4 w-4" />
          <span>{copy.mediaEvidenceConsent}</span>
        </label>
      )}
      <label className="flex items-start gap-3 text-[13px] text-[#444]">
        <input type="checkbox" checked={assessmentConsent}
          onChange={(event) => onAssessmentConsentChange(event.target.checked)} disabled={disabled}
          className="mt-0.5 h-4 w-4" />
        <span>{t.assessmentPlayer.consentBody} {t.assessmentPlayer.consentCheckboxLabel}</span>
      </label>
    </>
  );
}
