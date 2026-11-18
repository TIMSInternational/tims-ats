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
    // CallStateBridge also destroys on unmount; both are guarded, so this stays idempotent.
    if (daily && !daily.isDestroyed()) await daily.destroy().catch(() => undefined);
    onScoreWithoutVideo();
  };

  return (
    <div role="alert" className="tims-chrome flex flex-1 items-center justify-center bg-[#0a0a0a] p-6">
      <div className="max-w-sm text-center">
        <p className="text-white text-subheading font-medium mb-2">{t.interviewRoom.joinErrorTitle}</p>
        <p className="text-white/70 text-callout mb-5">{t.interviewRoom[MESSAGE_KEYS[category]]}</p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          className="min-h-11 rounded-lg bg-white px-6 py-2.5 text-body font-medium text-brand transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRetrying ? t.interviews.roomConnecting : t.interviewRoom.joinRetry}
        </button>
        <button
          type="button"
          onClick={handleScoreWithoutVideo}
          className="mx-auto mt-3 block min-h-9 rounded-lg border border-white/40 px-5 py-2 text-body font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
        >
          {t.interviewRoom.scoreWithoutVideo}
        </button>
      </div>
    </div>
  );
}
