'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button } from '../../../../components/button';
import { CHOICE_INPUT_CLASSES } from '../../../../components/field-styles';

export const AI_INTERVIEW_CONSENT_VERSION = 'v1';

interface ConsentScreenProps {
  candidateToken: string;
  onConsented: () => void;
}

/**
 * The tRPC codes recordConsent throws for a link that can no longer be used: NOT_FOUND (no such session)
 * and BAD_REQUEST (the session already started). Everything else is a transient failure worth retrying.
 */
function isUnusableLink(code: string | undefined): boolean {
  return code === 'NOT_FOUND' || code === 'BAD_REQUEST';
}

export function ConsentScreen({ candidateToken, onConsented }: ConsentScreenProps) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  const recordConsent = trpc.aiInterview.recordConsent.useMutation({
    onSuccess: () => onConsented(),
    // frontend.md: onError toast on every mutation. Never the server's own text (it may be English or a
    // validation dump): one mapped candidate message.
    onError: (err) =>
      toast(isUnusableLink(err.data?.code) ? t.aiInterview.invalidToken : t.aiInterview.consentError, { type: 'error' }),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-card sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint" aria-hidden="true">
            <svg className="size-5 text-brand" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" focusable="false">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            </svg>
          </div>
          <h1 className="font-display text-title font-semibold text-brand">{t.aiInterview.consentHeading}</h1>
        </div>

        <p className="mb-6 text-base leading-relaxed text-secondary sm:text-body">{t.aiInterview.consentDisclosure}</p>

        <label className="mb-6 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className={`mt-0.5 ${CHOICE_INPUT_CLASSES}`}
          />
          <span className="text-base leading-snug text-secondary sm:text-body">{t.aiInterview.consentCheckbox}</span>
        </label>

        <Button
          size="lg"
          fullWidth
          onClick={() =>
            recordConsent.mutate({
              candidateToken,
              textVersion: AI_INTERVIEW_CONSENT_VERSION,
            })
          }
          disabled={!checked}
          loading={recordConsent.isPending}
          loadingLabel={t.aiInterview.consentSaving}
        >
          {t.aiInterview.consentAgree}
        </Button>
      </div>
    </main>
  );
}
