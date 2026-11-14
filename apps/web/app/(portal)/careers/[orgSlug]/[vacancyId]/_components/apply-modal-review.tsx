'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { TurnstileWidget } from '../../../../../../components/turnstile-widget';
import { experienceLevelLabel } from '../_lib/experience-levels';
import { formatFileSize } from '../_lib/format-file-size';
import { SummaryRow } from './summary-row';
import { ApplyConsentCheckbox } from './apply-consent-checkbox';
import { CvUploadFailedAlert } from './cv-upload-failed-alert';

export interface ApplySummary {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: string;
  linkedinUrl: string;
  coverLetter: string;
}

interface ApplyModalReviewProps {
  summary: ApplySummary;
  vacancyTitle: string;
  controllerName: string;
  privacyHref: string;
  cvFile: File | null;
  cvUploadFailed: boolean;
  submitting: boolean;
  consentAccepted: boolean;
  onConsentChange: (checked: boolean) => void;
  onRetryCv: () => void;
  onRemoveCvAndContinue: () => void;
  turnstileSiteKey?: string;
  onCaptchaToken: (token: string | null) => void;
}

export function ApplyModalReview({
  summary: s,
  vacancyTitle,
  controllerName,
  privacyHref,
  cvFile,
  cvUploadFailed,
  submitting,
  consentAccepted,
  onConsentChange,
  onRetryCv,
  onRemoveCvAndContinue,
  turnstileSiteKey,
  onCaptchaToken,
}: ApplyModalReviewProps) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <div className="space-y-5">
      <dl className="space-y-2 rounded-lg bg-surface p-4">
        <SummaryRow label={p.summaryName} value={`${s.firstName} ${s.lastName}`} />
        <SummaryRow label={p.summaryEmail} value={s.email} />
        {s.phone && <SummaryRow label={p.summaryPhone} value={s.phone} />}
        {s.location && <SummaryRow label={p.summaryLocation} value={s.location} />}
        {s.currentTitle && (
          <SummaryRow
            label={p.summaryCurrentTitle}
            value={`${s.currentTitle}${s.currentCompany ? ` ${p.currentTitleAt} ${s.currentCompany}` : ''}`}
          />
        )}
        {s.yearsExperience && (
          <SummaryRow label={p.summaryExperience} value={experienceLevelLabel(s.yearsExperience, p.experienceLevels)} />
        )}
        {s.linkedinUrl && <SummaryRow label={p.linkedinLabel} value={s.linkedinUrl} />}
        {cvFile && <SummaryRow label={p.summaryCv} value={`${cvFile.name} (${formatFileSize(cvFile.size)})`} />}
        <SummaryRow label={p.summaryVacancy} value={vacancyTitle} />
      </dl>

      {cvUploadFailed && cvFile && (
        <CvUploadFailedAlert disabled={submitting} onRetry={onRetryCv} onRemoveAndContinue={onRemoveCvAndContinue} />
      )}

      {s.coverLetter.trim() && (
        <div>
          <p className="mb-2 text-callout font-medium text-secondary">{p.yourMessage}</p>
          <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-white p-3 text-body leading-relaxed text-secondary">
            {s.coverLetter}
          </div>
        </div>
      )}

      {turnstileSiteKey && (
        <div className="pt-1">
          <TurnstileWidget siteKey={turnstileSiteKey} onToken={onCaptchaToken} />
        </div>
      )}

      <ApplyConsentCheckbox
        controllerName={controllerName}
        privacyHref={privacyHref}
        checked={consentAccepted}
        onChange={onConsentChange}
        disabled={submitting}
      />
    </div>
  );
}
