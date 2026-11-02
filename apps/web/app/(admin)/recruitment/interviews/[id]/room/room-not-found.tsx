'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { trpcErrorCode } from './room-load-error';

/**
 * Shown when the room's interview cannot be loaded: an unknown or foreign id
 * gets an explicit "not found" state with a way back, never a blank page.
 */
export function RoomNotFound({ error }: { error: unknown }) {
  const { t } = useI18n();
  const code = trpcErrorCode(error);
  const isMissing = code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'BAD_REQUEST';

  return (
    <div className="h-full flex items-center justify-center bg-[#0a0a0a] px-6">
      <div role="alert" className="text-center max-w-sm">
        <p className="text-white text-[14px] font-medium mb-2">
          {isMissing ? t.interviews.roomInterviewNotFound : t.interviews.couldNotLoadInterview}
        </p>
        <p className="text-white/70 text-[12px] mb-5">
          {isMissing ? t.interviews.roomInterviewNotFoundDesc : t.interviews.roomLoadErrorDesc}
        </p>
        <a
          href="/recruitment/interviews"
          className="inline-flex items-center h-9 px-4 rounded-lg bg-white text-[#1F114C] text-[12px] font-medium hover:bg-white/90 transition"
        >
          {t.interviews.roomBackToInterviews}
        </a>
      </div>
    </div>
  );
}
