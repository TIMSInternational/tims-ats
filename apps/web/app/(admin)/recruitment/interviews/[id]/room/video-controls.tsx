'use client';

import { hardNavigate, ROOM_EXIT_PATH } from './hard-exit';
import { useState, useCallback } from 'react';
import { useDaily, useMeetingState, useDailyEvent } from '@daily-co/daily-react';
import { useI18n } from '../../../../../../lib/i18n';

export function VideoControls() {
  const { t } = useI18n();
  const daily = useDaily();
  const meetingState = useMeetingState();
  const isJoined = meetingState === 'joined-meeting';

  const [isCamOff, setIsCamOff] = useState(false);
  const [isMicOff, setIsMicOff] = useState(false);

  // Sync track state from Daily events
  useDailyEvent('participant-updated', useCallback((ev: { participant: { local: boolean; video: boolean; audio: boolean } }) => {
    if (ev?.participant?.local) {
      setIsCamOff(!ev.participant.video);
      setIsMicOff(!ev.participant.audio);
    }
  }, []));

  useDailyEvent('joined-meeting', useCallback(() => {
    if (!daily) return;
    const local = daily.participants()?.local;
    if (local) {
      setIsCamOff(!local.video);
      setIsMicOff(!local.audio);
    }
  }, [daily]));

  const toggleCamera = useCallback(() => {
    if (!daily || !isJoined) return;
    daily.setLocalVideo(isCamOff);
  }, [daily, isCamOff, isJoined]);

  const toggleMic = useCallback(() => {
    if (!daily || !isJoined) return;
    daily.setLocalAudio(isMicOff);
  }, [daily, isMicOff, isJoined]);

  const shareScreen = useCallback(() => {
    if (!daily || !isJoined) return;
    daily.startScreenShare();
  }, [daily, isJoined]);

  const handleLeave = useCallback(() => {
    if (daily) daily.leave().catch(() => {});
    hardNavigate(ROOM_EXIT_PATH);
  }, [daily]);

  const btnBase = 'size-10 rounded-full flex items-center justify-center transition-colors relative pointer-coarse:size-11';
  const btnDisabled = 'bg-white/5 cursor-not-allowed';
  const btnOn = 'bg-white/10 hover:bg-white/20';
  const btnOff = 'bg-red-500/80 hover:bg-red-500';
  // Off is shown by a slashed icon too, never by the red fill alone (accessibility.md › Vision).
  const slash = <path d="M3 3l18 18" strokeLinecap="round" />;

  return (
    <div className="tims-chrome flex shrink-0 items-center justify-center gap-3 bg-[#111] py-3">
      {/* Camera: a toggle with a stable name; aria-pressed says whether it is off. */}
      <button
        type="button"
        onClick={toggleCamera}
        disabled={!isJoined}
        aria-label={t.interviews.roomCamera}
        aria-pressed={isCamOff}
        className={`${btnBase} ${!isJoined ? btnDisabled : isCamOff ? btnOff : btnOn}`}
        title={isCamOff ? t.interviews.roomCameraOn : t.interviews.roomCameraOff}
      >
        <svg className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          {isCamOff && slash}
        </svg>
      </button>

      {/* Mic */}
      <button
        type="button"
        onClick={toggleMic}
        disabled={!isJoined}
        aria-label={t.interviews.roomMic}
        aria-pressed={isMicOff}
        className={`${btnBase} ${!isJoined ? btnDisabled : isMicOff ? btnOff : btnOn}`}
        title={isMicOff ? t.interviews.roomMicOn : t.interviews.roomMicOff}
      >
        <svg className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          {isMicOff && slash}
        </svg>
      </button>

      {/* Screen share */}
      <button
        type="button"
        onClick={shareScreen}
        disabled={!isJoined}
        aria-label={t.interviews.shareScreen}
        className={`${btnBase} ${!isJoined ? btnDisabled : btnOn}`}
        title={t.interviews.shareScreen}
      >
        <svg className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3v11.25" />
        </svg>
      </button>

      {/* Leave */}
      <button
        type="button"
        onClick={handleLeave}
        aria-label={t.interviews.roomLeave}
        className={`${btnBase} ml-4 bg-brand-red hover:bg-brand-red-hover`}
        title={t.interviews.roomLeave}
      >
        <svg className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
        </svg>
      </button>
    </div>
  );
}
