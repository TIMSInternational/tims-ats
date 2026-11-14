'use client';

import { useId, useRef, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { useDialogA11y } from '../../../../lib/use-dialog-a11y';
import { Button } from '../../../../components';

interface ApiKeySecretDialogProps {
  rawKey: string;
  onClose: () => void;
}

/**
 * The one-time key. Deliberately NOT the shared Modal: that closes on an overlay click and would discard the
 * only copy of the secret. Only the explicit button or Escape closes it (settings-26).
 */
export function ApiKeySecretDialog({ rawKey, onClose }: ApiKeySecretDialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `api-key-secret-${useId()}`;
  const warnId = `${titleId}-warn`;
  const [copied, setCopied] = useState(false);
  useDialogA11y(ref, onClose);

  function copyKey() {
    navigator.clipboard.writeText(rawKey).then(() => setCopied(true));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={warnId}
    >
      <div ref={ref} className="mx-4 w-full max-w-[420px] space-y-3 rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id={titleId} className="text-heading font-semibold text-primary">
          {t.integrations.apiKeyCreated}
        </h2>
        <p id={warnId} className="flex items-start gap-1.5 text-callout text-danger">
          <svg
            className="mt-px size-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          {t.integrations.apiKeyCopyWarn}
        </p>
        <code className="block select-all break-all rounded-lg bg-surface p-3 font-mono text-body text-primary">
          {rawKey}
        </code>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant={copied ? 'primary' : 'secondary'} onClick={onClose}>
            {t.integrations.apiKeyClose}
          </Button>
          <Button variant={copied ? 'secondary' : 'primary'} onClick={copyKey} data-autofocus>
            {copied ? t.integrations.apiKeyCopied : t.integrations.apiKeyCopy}
          </Button>
        </div>
      </div>
    </div>
  );
}
