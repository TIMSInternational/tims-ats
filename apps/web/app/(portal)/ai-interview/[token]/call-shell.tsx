'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import type { InterviewCall } from './use-interview-call';
import { AiOrb } from './ai-orb';
import { ParticipantTile } from './participant-tile';
import { TranscriptPanel } from './transcript-panel';
import { CallControls } from './call-controls';
import { shouldAutoEnd } from './should-auto-end';

function useElapsed(running: boolean): { label: string; secs: number } {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return { label: `${mm}:${ss}`, secs };
}

export function CallShell({ call }: { call: InterviewCall }) {
  const { t } = useI18n();
  const [view, setView] = useState<'call' | 'focus'>('call');
  const { label: elapsed, secs } = useElapsed(call.status === 'connected');

  useEffect(() => {
    if (call.status === 'connected' && shouldAutoEnd(secs, call.maxDurationSeconds)) {
      call.end();
    }
  }, [secs, call.status, call.maxDurationSeconds, call.end]);
  const orbState =
    call.status === 'connecting'
      ? 'connecting'
      : call.isAiSpeaking
        ? 'speaking'
        : 'listening';
  const statusLabel =
    call.status === 'connected'
      ? t.aiInterview.connected
      : call.status === 'reconnecting'
        ? t.aiInterview.reconnecting
        : t.aiInterview.connecting;

  return (
    <div className="min-h-screen bg-[#0E0A1F] flex flex-col text-white">
      <header className="flex items-center justify-between px-5 py-3 text-xs text-[#9a92c0]">
        <span>🔴 {elapsed} · {t.aiInterview.title} · {statusLabel}</span>
      </header>

      <main className="flex-1 min-h-0 px-5 pb-4">
        {view === 'call' ? (
          <div className="h-full flex gap-4">
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex-1 rounded-xl bg-[#160f2e] border-2 border-[#7c5cff] flex items-center justify-center">
                <AiOrb state={orbState} size="lg" />
              </div>
              <ParticipantTile name={t.aiInterview.you} level={call.micMuted ? 0 : 0.4} muted={call.micMuted} />
            </div>
            <div className="w-[42%] flex flex-col">
              <TranscriptPanel transcript={call.transcript} variant="panel" />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center gap-6 pt-8 overflow-y-auto">
            <AiOrb state={orbState} size="lg" />
            <TranscriptPanel transcript={call.transcript} variant="focus" />
          </div>
        )}
      </main>

      <footer className="px-5 py-4">
        <CallControls
          micMuted={call.micMuted}
          onToggleMute={call.toggleMute}
          view={view}
          onToggleView={() => setView((v) => (v === 'call' ? 'focus' : 'call'))}
          onEnd={call.end}
        />
      </footer>
    </div>
  );
}
