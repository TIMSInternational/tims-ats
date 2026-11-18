'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../../../../lib/i18n';
import { formatMessage } from '../../../../../../../../lib/i18n/format';

const WARN_AT = [300, 60] as const;

function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// The quiz countdown as a chip. At 5 minutes and at 1 minute it turns to the warning tone and says so once in a
// polite live region, so time running out is never only visual (accessibility.md › Cognitive). The auto-submit at
// 0:00 is unchanged (the wizard's countdown hook owns it).
export function AssessmentTimer({ remainingSeconds }: { remainingSeconds: number }) {
  const { t } = useI18n();
  const p = t.assessmentPlayer;
  const [announcement, setAnnouncement] = useState('');
  const warning = remainingSeconds <= WARN_AT[0];

  useEffect(() => {
    if (remainingSeconds === WARN_AT[0]) setAnnouncement(p.timerWarning5);
    else if (remainingSeconds === WARN_AT[1]) setAnnouncement(p.timerWarning1);
  }, [remainingSeconds, p.timerWarning5, p.timerWarning1]);

  return (
    <>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-callout font-semibold tabular-nums ${
          warning ? 'bg-warning-bg text-warning' : 'bg-surface text-secondary'
        }`}
      >
        <svg
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
        {formatMessage(p.timerRemaining, { time: clock(remainingSeconds) })}
      </span>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
