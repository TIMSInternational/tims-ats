'use client';

import { useI18n } from '../../../../../../lib/i18n';

interface ScoringStageProps {
  candidateName: string;
  candidateInitials: string;
  subtitle: string;
  location: string | null;
  /** Present for a video interview being scored without video: offers the call again. */
  onJoinVideo?: () => void;
}

/**
 * Replaces the video stage when the evaluator scores without a video call —
 * always for in-person/phone interviews, on request for video ones. Renders
 * nothing from Daily, so the scorecard never depends on the video provider.
 */
export function ScoringStage({ candidateName, candidateInitials, subtitle, location, onJoinVideo }: ScoringStageProps) {
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
          <p className="text-white/50 text-[12px] mb-2">
            {t.interviewRoom.locationValue.replace('{location}', location)}
          </p>
        )}
        <p className="text-white/70 text-[12px] mt-4">
          {onJoinVideo ? t.interviewRoom.scoringWithoutVideoNotice : t.interviewRoom.scoringInPersonNotice}
        </p>
        {onJoinVideo && (
          <button
            type="button"
            onClick={onJoinVideo}
            className="mt-5 text-white/80 border border-white/20 px-5 py-2 rounded-lg text-[13px] font-medium hover:bg-white/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {t.interviewRoom.joinVideoCall}
          </button>
        )}
      </div>
    </div>
  );
}
