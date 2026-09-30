'use client';

import { useI18n } from '../../../../../../lib/i18n';

interface CvUploadFailedAlertProps {
  disabled: boolean;
  onRetry: () => void;
  onRemoveAndContinue: () => void;
}

// Inline, blocking explanation for a failed CV upload (presign error, or the S3 POST
// failing / being blocked). The application has NOT been sent at this point, so the
// candidate must be told and given both ways forward.
export function CvUploadFailedAlert({ disabled, onRetry, onRemoveAndContinue }: CvUploadFailedAlertProps) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <div role="alert" className="rounded-lg border border-[#DD0C15]/30 bg-[#DD0C15]/5 p-3">
      <p className="text-[13px] font-semibold text-[#DD0C15]">{p.cvUploadFailedTitle}</p>
      <p className="mt-1 text-[12px] text-[#585858]">{p.cvUploadFailedBody}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className="h-8 rounded-lg bg-[#1F114C] px-3 text-[12px] font-medium text-white transition hover:bg-[#2a1a5c] disabled:opacity-50"
        >
          {p.cvRetryUpload}
        </button>
        <button
          type="button"
          onClick={onRemoveAndContinue}
          disabled={disabled}
          className="h-8 rounded-lg border border-[#EDEDED] bg-white px-3 text-[12px] font-medium text-[#585858] transition hover:bg-[#F6F6F6] disabled:opacity-50"
        >
          {p.cvRemoveAndContinue}
        </button>
      </div>
    </div>
  );
}
