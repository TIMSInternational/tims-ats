'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { trpcErrorCode } from './room-load-error';
import { buttonClasses } from '../../../../../../components/button-styles';

/**
 * Shown when the room's interview cannot be loaded: an unknown or foreign id
 * gets an explicit "not found" state with a way back, never a blank page.
 */
export function RoomNotFound({ error }: { error: unknown }) {
  const { t } = useI18n();
  const code = trpcErrorCode(error);
  const isMissing = code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'BAD_REQUEST';

  return (
    <div className="flex h-full items-center justify-center bg-surface px-6">
      <div role="alert" className="max-w-sm text-center">
        <svg className="mx-auto mb-3 size-8 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="mb-1 text-subheading font-semibold text-primary">
          {isMissing ? t.interviews.roomInterviewNotFound : t.interviews.couldNotLoadInterview}
        </p>
        <p className="mb-5 text-callout text-secondary">
          {isMissing ? t.interviews.roomInterviewNotFoundDesc : t.interviews.roomLoadErrorDesc}
        </p>
        {/* Plain <a>: leaving the room is always a full document load (./hard-exit.ts). */}
        <a href="/recruitment/interviews" className={buttonClasses({ variant: 'secondary' })}>
          {t.interviews.roomBackToInterviews}
        </a>
      </div>
    </div>
  );
}
