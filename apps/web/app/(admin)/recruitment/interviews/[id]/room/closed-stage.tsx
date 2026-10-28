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
    <div role="status" className="flex-1 flex items-center justify-center bg-[#0a0a0a] p-6">
      <div className="max-w-sm text-center">
        <p className="text-white text-[16px] font-medium mb-1">{candidateName}</p>
        <p className="text-white/50 text-[13px] mb-4">{subtitle}</p>
        <p className="text-white/80 text-[13px]">{message}</p>
      </div>
    </div>
  );
}
