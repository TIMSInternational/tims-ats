'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { Button } from '../../../../../../components/button';

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

  // The white work panel (not the dark video stage): there is no call to frame. Below md it is a compact
  // header row so the scorecard, the actual task, starts above the fold (layout.md › Visual hierarchy).
  return (
    <div className="flex flex-1 items-start bg-surface p-4 md:items-center md:justify-center md:p-6">
      <div className="flex w-full items-start gap-3 md:max-w-sm md:flex-col md:items-center md:text-center">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand md:mb-3 md:size-16" aria-hidden="true">
          <span className="text-subheading font-semibold text-white md:text-xl">{candidateInitials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-heading font-semibold text-primary">{candidateName}</p>
          <p className="text-callout text-secondary">{subtitle}</p>
          {location && (
            <p className="mt-1 break-words text-callout text-secondary">
              {/* Function replacer: a `$&`-style pattern in user-entered text must stay literal. */}
              {t.interviewRoom.locationValue.replace('{location}', () => location)}
            </p>
          )}
          <p className="mt-3 text-callout text-primary">
            {onJoinVideo ? t.interviewRoom.scoringWithoutVideoNotice : t.interviewRoom.scoringInPersonNotice}
          </p>
          {onJoinVideo && (
            <Button variant="secondary" className="mt-4" onClick={onJoinVideo} loading={isJoining} loadingLabel={t.interviews.roomConnecting}>
              {t.interviewRoom.joinVideoCall}
            </Button>
          )}
          {joinErrorMessage && <p role="alert" className="mt-3 text-callout text-danger">{joinErrorMessage}</p>}
        </div>
      </div>
    </div>
  );
}
