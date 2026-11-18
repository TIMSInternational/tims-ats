'use client';

import { useI18n } from '../../../../../../lib/i18n';

interface RoomLobbyProps {
  candidateName: string;
  candidateInitials: string;
  subtitle: string;
  isJoining: boolean;
  /** Message from a failed interview.createVideoRoom (e.g. video not configured). */
  joinErrorMessage: string | null;
  onJoin: () => void;
  /** Opens the scorecard without creating a video room or loading Daily. */
  onScoreWithoutVideo: () => void;
}

/** Pre-join lobby of a video interview: join the call, or score without video. */
export function RoomLobby({
  candidateName,
  candidateInitials,
  subtitle,
  isJoining,
  joinErrorMessage,
  onJoin,
  onScoreWithoutVideo,
}: RoomLobbyProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-1 items-center justify-center bg-[#0a0a0a] p-6">
      <div className="text-center">
        <div className="mx-auto mb-6 flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#5C4B99]" aria-hidden="true">
          <span className="text-white text-3xl font-bold">{candidateInitials}</span>
        </div>
        <p className="text-white text-heading font-medium mb-1">{candidateName}</p>
        <p className="text-white/70 text-body mb-6">{subtitle}</p>
        <button
          type="button"
          onClick={onJoin}
          disabled={isJoining}
          className="mx-auto flex min-h-11 items-center gap-2 rounded-xl bg-white px-8 py-3 text-subheading font-medium text-brand transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isJoining ? (
            <>
              <div className="size-4 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden="true" />
              {t.interviews.roomConnecting}
            </>
          ) : (
            <>
              <svg
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              {t.interviews.roomJoin}
            </>
          )}
        </button>
        {joinErrorMessage && <p role="alert" className="text-red-300 text-callout mt-3">{joinErrorMessage}</p>}
        <div className="mt-6">
          <button
            type="button"
            onClick={onScoreWithoutVideo}
            // Disabled while a join is in flight, so a late token cannot race this switch.
            disabled={isJoining}
            className="min-h-9 rounded-lg border border-white/40 px-5 py-2 text-body font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
          >
            {t.interviewRoom.scoreWithoutVideo}
          </button>
          <p className="text-white/70 text-caption mt-2">{t.interviewRoom.scoreWithoutVideoHint}</p>
        </div>
      </div>
    </div>
  );
}
