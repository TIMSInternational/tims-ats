'use client';

import { useI18n } from '../../../../../../lib/i18n';

interface CancelledStageProps {
  candidateName: string;
  subtitle: string;
}

/**
 * A cancelled interview can be neither joined nor scored from the room. This is
 * a UI guard only: interview.submitScorecard does not yet refuse cancelled
 * interviews server-side (tracked as a follow-up issue).
 */
export function CancelledStage({ candidateName, subtitle }: CancelledStageProps) {
  const { t } = useI18n();

  return (
    <div role="status" className="flex-1 flex items-center justify-center bg-[#0a0a0a] p-6">
      <div className="max-w-sm text-center">
        <p className="text-white text-[16px] font-medium mb-1">{candidateName}</p>
        <p className="text-white/50 text-[13px] mb-4">{subtitle}</p>
        <p className="text-white/80 text-[13px]">{t.interviewRoom.cancelledNotice}</p>
      </div>
    </div>
  );
}
