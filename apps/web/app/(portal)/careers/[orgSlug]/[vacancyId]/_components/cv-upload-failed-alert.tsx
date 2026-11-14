'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { Button } from '../../../../../../components/button';

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
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-bg p-3">
      <p className="text-body font-semibold text-danger">{p.cvUploadFailedTitle}</p>
      <p className="mt-1 text-callout text-secondary">{p.cvUploadFailedBody}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onRemoveAndContinue} disabled={disabled}>
          {p.cvRemoveAndContinue}
        </Button>
        <Button size="sm" onClick={onRetry} disabled={disabled}>
          {p.cvRetryUpload}
        </Button>
      </div>
    </div>
  );
}
