'use client';

import { useI18n } from '../../lib/i18n';

// Says why the submit button is still disabled while the Turnstile check runs (entering-data.md › Best
// practices). Point the button's aria-describedby at `id` while `pending`.
// The line keeps its space once the check passes (invisible, not removed): the auth card is centred
// vertically, so removing it would move the submit button at the instant it becomes clickable and a quick
// click would land on empty space.
export function CaptchaHint({ id, pending }: { id: string; pending: boolean }) {
  const { t } = useI18n();
  return (
    <p
      id={id}
      aria-hidden={!pending || undefined}
      className={`mt-1.5 text-center text-callout text-secondary ${pending ? '' : 'invisible'}`}
    >
      {t.auth.captchaPending}
    </p>
  );
}
