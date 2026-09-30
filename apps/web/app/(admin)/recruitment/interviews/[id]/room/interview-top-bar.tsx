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
}

export function InterviewTopBar({
  candidateName,
  vacancyTitle,
  fitScore,
  isCallActive,
  onLeaveCall,
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

  return (
    <div className="flex items-center justify-between px-6 h-[50px] bg-[#1F114C] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-white/60">{t.interviewRoom.topBarLabel}</span>
        <span className="text-[13px] text-white font-medium">{candidateName}</span>
        <span className="text-[11px] text-white/40">&mdash;</span>
        <span className="text-[13px] text-white/60">{vacancyTitle}</span>
        {fitScore != null && (
          <span className="bg-green-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full ml-2">
            FIT: {fitScore}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Timer */}
        {isCallActive && (
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[14px] text-white font-mono font-medium">
              {minutes}:{seconds}
            </span>
          </div>
        )}

        {/* End button */}
        <button
          onClick={handleEnd}
          className="bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:bg-[#c00b13] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          {t.interviewRoom.endCall}
        </button>
      </div>
    </div>
  );
}
