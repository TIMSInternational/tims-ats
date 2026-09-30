'use client';

import { useState } from 'react';
import { useDaily } from '@daily-co/daily-react';
import { useI18n } from '../../../../../../lib/i18n';
import type { DailyJoinErrorCategory } from './daily-join-error';

interface JoinErrorPanelProps {
  category: DailyJoinErrorCategory;
  /** Re-mints a room token and remounts the join. */
  onRetry: () => Promise<void> | void;
  /** Leaves the failed call and keeps scoring without video. */
  onScoreWithoutVideo: () => void;
}

const MESSAGE_KEYS = {
  blocked: 'joinErrorBlocked',
  expired: 'joinErrorExpired',
  unavailable: 'joinErrorUnavailable',
  network: 'joinErrorNetwork',
  unknown: 'joinErrorUnknown',
} as const satisfies Record<DailyJoinErrorCategory, string>;

/** Replaces the video stage when the Daily call could not be joined. */
export function JoinErrorPanel({ category, onRetry, onScoreWithoutVideo }: JoinErrorPanelProps) {
  const { t } = useI18n();
  const daily = useDaily();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      // The failed call object is a singleton; destroy it so the provider builds a clean one.
      if (daily && !daily.isDestroyed()) await daily.destroy().catch(() => undefined);
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleScoreWithoutVideo = async () => {
    // Tear the failed call object down before the provider unmounts.
    if (daily && !daily.isDestroyed()) await daily.destroy().catch(() => undefined);
    onScoreWithoutVideo();
  };

  return (
    <div role="alert" className="flex-1 flex items-center justify-center bg-[#0a0a0a] p-6">
      <div className="max-w-sm text-center">
        <p className="text-white text-[15px] font-medium mb-2">{t.interviewRoom.joinErrorTitle}</p>
        <p className="text-white/60 text-[12px] mb-5">{t.interviewRoom[MESSAGE_KEYS[category]]}</p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          className="bg-[#DD0C15] text-white px-6 py-2.5 rounded-lg text-[13px] font-medium hover:bg-[#c00b13] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRetrying ? t.interviews.roomConnecting : t.interviewRoom.joinRetry}
        </button>
        <button
          type="button"
          onClick={handleScoreWithoutVideo}
          disabled={isRetrying}
          className="block mx-auto mt-3 text-white/80 border border-white/20 px-5 py-2 rounded-lg text-[13px] font-medium hover:bg-white/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t.interviewRoom.scoreWithoutVideo}
        </button>
      </div>
    </div>
  );
}
