'use client';

interface ClosedStageProps {
  candidateName: string;
  subtitle: string;
  message: string;
}

/**
 * An interview whose status is not open (cancelled, no_show, or anything else
 * outside ROOM_STATUSES) can be neither joined nor scored from the room. The
 * server also refuses scorecards for `cancelled` and `no_show` interviews
 * (interview.submitScorecard, #327); any other non-room status is a UI guard only.
 */
export function ClosedStage({ candidateName, subtitle, message }: ClosedStageProps) {
  return (
    <div role="status" className="flex flex-1 items-center justify-center bg-surface p-6">
      <div className="max-w-sm text-center">
        <p className="mb-1 text-heading font-semibold text-primary">{candidateName}</p>
        <p className="mb-4 text-callout text-secondary">{subtitle}</p>
        <p className="text-body text-primary">{message}</p>
      </div>
    </div>
  );
}
