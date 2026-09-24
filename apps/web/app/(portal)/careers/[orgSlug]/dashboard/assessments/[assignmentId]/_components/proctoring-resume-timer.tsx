'use client';

import { useI18n } from '../../../../../../../../lib/i18n';
import { useAssessmentCountdown } from '../_lib/use-assessment-countdown';

interface ProctoringResumeTimerProps {
  startedAt: Date;
  expiresAt: Date | null;
  durationMinutes: number | null;
}

export function ProctoringResumeTimer({ startedAt, expiresAt, durationMinutes }: ProctoringResumeTimerProps) {
  const { t } = useI18n();
  const seconds = useAssessmentCountdown({ startedAt, expiresAt, durationMinutes, onExpire: () => undefined });
  if (seconds === null) return null;
  return (
    <p role="status" className="mx-auto max-w-xl rounded-xl bg-[#FFF4E5] px-4 py-2 text-[13px] text-[#985B00]">
      {t.proctoring.candidate.remainingTime} {String(Math.floor(seconds / 60)).padStart(2, '0')}:
      {String(seconds % 60).padStart(2, '0')}
    </p>
  );
}
