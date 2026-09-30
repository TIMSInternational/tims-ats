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
    <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-center">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#1F114C] to-[#5C4B99] flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-3xl font-bold">{candidateInitials}</span>
        </div>
        <p className="text-white text-[16px] font-medium mb-1">{candidateName}</p>
        <p className="text-white/50 text-[13px] mb-6">{subtitle}</p>
        <button
          type="button"
          onClick={onJoin}
          disabled={isJoining}
          className="bg-[#DD0C15] text-white px-8 py-3 rounded-xl text-[14px] font-medium shadow-[0_4px_16px_rgba(221,12,21,0.3)] hover:bg-[#c00b13] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
        >
          {isJoining ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t.interviews.roomConnecting}
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
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
        {joinErrorMessage && <p className="text-red-400 text-[12px] mt-3">{joinErrorMessage}</p>}
        <div className="mt-6">
          <button
            type="button"
            onClick={onScoreWithoutVideo}
            className="text-white/80 border border-white/20 px-5 py-2 rounded-lg text-[13px] font-medium hover:bg-white/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {t.interviewRoom.scoreWithoutVideo}
          </button>
          <p className="text-white/40 text-[11px] mt-2">{t.interviewRoom.scoreWithoutVideoHint}</p>
        </div>
      </div>
    </div>
  );
}
