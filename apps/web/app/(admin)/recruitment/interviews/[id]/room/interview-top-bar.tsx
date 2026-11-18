'use client';

import { hardNavigate, ROOM_EXIT_PATH } from './hard-exit';
import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../../../../../lib/i18n';

interface InterviewTopBarProps {
  candidateName: string;
  vacancyTitle: string;
  fitScore?: number;
  /** True only while the Daily call is joined (reported by CallStateBridge). */
  isCallActive: boolean;
  /** Leaves the Daily call, if one exists, before the hard exit. */
  onLeaveCall?: () => void;
  /** "Reprogramar" (recruiter-journeys-28); omitted when the viewer may not manage the interview or it cannot move. */
  onReschedule?: () => void;
}

export function InterviewTopBar({
  candidateName,
  vacancyTitle,
  fitScore,
  isCallActive,
  onLeaveCall,
  onReschedule,
}: InterviewTopBarProps) {
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isCallActive) return;
    // Each call starts its own clock (a rejoin must not resume the previous one).
    setElapsed(0);
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isCallActive]);

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');

  const handleEnd = useCallback(() => {
    onLeaveCall?.();
    hardNavigate(ROOM_EXIT_PATH);
  }, [onLeaveCall]);

  // While a call runs, the red button ends it; otherwise it only leaves the room, so it reads "Salir de la
  // sala" in a secondary style (buttons.md › Role: red is for destructive actions only).
  const exitClasses = isCallActive
    ? 'bg-brand-red text-white hover:bg-brand-red-hover'
    : 'border border-white/40 text-white hover:bg-white/10';

  // Wraps onto two rows below sm instead of pushing the actions past the viewport (layout.md › Size classes).
  return (
    <div className="tims-chrome flex min-h-[50px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-brand px-4 py-2 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="hidden shrink-0 text-body text-white/70 sm:inline">{t.interviewRoom.topBarLabel}</span>
        <span className="truncate text-body font-medium text-white">{candidateName}</span>
        <span className="hidden text-caption text-white/70 sm:inline" aria-hidden="true">&mdash;</span>
        <span className="hidden truncate text-body text-white/70 sm:inline">{vacancyTitle}</span>
        {fitScore != null && (
          <span className="ml-2 shrink-0 rounded-full bg-success px-2 py-0.5 text-caption font-semibold text-white">
            FIT: {fitScore}
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-4">
        {/* Timer */}
        {isCallActive && (
          <div className="flex items-center gap-2">
            <svg className="size-4 text-white/70" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-mono text-subheading font-medium text-white tabular-nums">
              {minutes}:{seconds}
            </span>
          </div>
        )}

        {onReschedule && (
          <button
            type="button"
            onClick={onReschedule}
            className="h-8 rounded-lg border border-white/40 px-3 text-callout font-medium text-white transition-colors hover:bg-white/10 pointer-coarse:h-11"
          >
            {t.interviews.reschedule}
          </button>
        )}

        <button
          type="button"
          onClick={handleEnd}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-4 text-callout font-medium transition-colors pointer-coarse:h-11 ${exitClasses}`}
        >
          <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          {isCallActive ? t.interviewRoom.endCall : t.interviewRoom.leaveRoom}
        </button>
      </div>
    </div>
  );
}
