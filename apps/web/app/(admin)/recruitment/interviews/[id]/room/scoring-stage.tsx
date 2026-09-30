'use client';

import { useI18n } from '../../../../../../lib/i18n';

interface ScoringStageProps {
  candidateName: string;
  candidateInitials: string;
  subtitle: string;
  location: string | null;
  /** Present for a video interview being scored without video: offers the call again. */
  onJoinVideo?: () => void;
  isJoining?: boolean;
  /** Message from a failed interview.createVideoRoom started from this stage. */
  joinErrorMessage?: string | null;
}

/**
 * The video stage's replacement while the evaluator scores without a video
 * call: always for non-video interviews, on request (or once completed) for
 * video ones. Uses nothing from Daily; the scorecard sits beside it.
 */
export function ScoringStage({
  candidateName,
  candidateInitials,
  subtitle,
  location,
  onJoinVideo,
  isJoining = false,
  joinErrorMessage = null,
}: ScoringStageProps) {
  const { t } = useI18n();

  return (
    <div className="flex-1 flex items-center justify-center bg-[#0a0a0a] p-6">
      <div className="max-w-sm text-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#1F114C] to-[#5C4B99] flex items-center justify-center mx-auto mb-5">
          <span className="text-white text-2xl font-bold">{candidateInitials}</span>
        </div>
        <p className="text-white text-[16px] font-medium mb-1">{candidateName}</p>
        <p className="text-white/50 text-[13px] mb-2">{subtitle}</p>
        {location && (
          <p className="text-white/50 text-[12px] mb-2 break-words">
            {/* Function replacer: a `$&`-style pattern in user-entered text must stay literal. */}
            {t.interviewRoom.locationValue.replace('{location}', () => location)}
          </p>
        )}
        <p className="text-white/70 text-[12px] mt-4">
          {onJoinVideo ? t.interviewRoom.scoringWithoutVideoNotice : t.interviewRoom.scoringInPersonNotice}
        </p>
        {onJoinVideo && (
          <button
            type="button"
            onClick={onJoinVideo}
            disabled={isJoining}
            className="mt-5 text-white/80 border border-white/20 px-5 py-2 rounded-lg text-[13px] font-medium hover:bg-white/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isJoining ? t.interviews.roomConnecting : t.interviewRoom.joinVideoCall}
          </button>
        )}
        {joinErrorMessage && <p className="text-red-400 text-[12px] mt-3">{joinErrorMessage}</p>}
      </div>
    </div>
  );
}
