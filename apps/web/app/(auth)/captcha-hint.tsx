'use client';

import { useI18n } from '../../lib/i18n';

// Says why the submit button is still disabled while the Turnstile check runs (entering-data.md › Best
// practices). Point the button's aria-describedby at `id` while `pending`.
export function CaptchaHint({ id, pending }: { id: string; pending: boolean }) {
  const { t } = useI18n();
  if (!pending) return null;
  return (
    <p id={id} className="mt-1.5 text-center text-callout text-secondary">
      {t.auth.captchaPending}
    </p>
  );
}
