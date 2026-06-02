'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  useDaily,
  useLocalSessionId,
  useVideoTrack,
  useAudioTrack,
} from '@daily-co/daily-react';

export function VideoControls() {
  const daily = useDaily();
  const router = useRouter();
  const localSessionId = useLocalSessionId();

  // Only access tracks when we have a valid local session
  const hasSession = !!localSessionId;
  const localVideo = useVideoTrack(localSessionId ?? 'placeholder');
  const localAudio = useAudioTrack(localSessionId ?? 'placeholder');

  const isCamOff = hasSession ? localVideo.isOff : true;
  const isMicOff = hasSession ? localAudio.isOff : true;

  const toggleCamera = useCallback(() => {
    if (!daily || !hasSession) return;
    daily.setLocalVideo(isCamOff);
  }, [daily, isCamOff, hasSession]);

  const toggleMic = useCallback(() => {
    if (!daily || !hasSession) return;
    daily.setLocalAudio(isMicOff);
  }, [daily, isMicOff, hasSession]);

  const shareScreen = useCallback(() => {
    if (!daily || !hasSession) return;
    daily.startScreenShare();
  }, [daily, hasSession]);

  const handleLeave = useCallback(() => {
    if (daily) {
      daily.leave().catch(() => {});
    }
    router.push('/recruitment/interviews');
  }, [daily, router]);

  return (
    <div className="flex items-center justify-center gap-3 py-3 bg-[#111]">
      {/* Camera toggle */}
      <button
        onClick={toggleCamera}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
          isCamOff ? 'bg-red-500/80 hover:bg-red-500' : 'bg-white/10 hover:bg-white/20'
        }`}
        title={isCamOff ? 'Activar camara' : 'Desactivar camara'}
      >
        {isCamOff ? (
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 9.091L16.5 19.5l-1.659-1.591m0 0L12 14.25m2.841 3.659l-2.841-3.66M2.25 9V7.5a2.25 2.25 0 012.25-2.25h9a2.25 2.25 0 012.25 2.25V9M2.25 9l7.5 7.5" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
        )}
      </button>

      {/* Mic toggle */}
      <button
        onClick={toggleMic}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
          isMicOff ? 'bg-red-500/80 hover:bg-red-500' : 'bg-white/10 hover:bg-white/20'
        }`}
        title={isMicOff ? 'Activar microfono' : 'Desactivar microfono'}
      >
        {isMicOff ? (
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            <path d="M3 3l18 18" strokeWidth="2" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>

      {/* Screen share */}
      <button
        onClick={shareScreen}
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        title="Compartir pantalla"
      >
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3v11.25" />
        </svg>
      </button>

      {/* Chat */}
      <button
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        title="Chat"
      >
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      </button>

      {/* Notes */}
      <button
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        title="Notas"
      >
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        </svg>
      </button>

      {/* Leave (red) */}
      <button
        onClick={handleLeave}
        className="w-10 h-10 rounded-full bg-[#DD0C15] hover:bg-[#c00b13] flex items-center justify-center transition-colors ml-4"
        title="Salir de la llamada"
      >
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
        </svg>
      </button>
    </div>
  );
}
