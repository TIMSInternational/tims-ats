'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import type { InterviewCall } from './use-interview-call';
import { AiOrb } from './ai-orb';
import { ParticipantTile } from './participant-tile';
import { TranscriptPanel } from './transcript-panel';
import { CallControls } from './call-controls';
import { shouldAutoEnd } from './should-auto-end';

function useElapsed(running: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  return secs;
}

function clock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function CallShell({ call }: { call: InterviewCall }) {
  const { t } = useI18n();
  const ai = t.aiInterview;
  const [view, setView] = useState<'call' | 'focus'>('call');
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const secs = useElapsed(call.status === 'connected');

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
      ? ai.connected
      : call.status === 'reconnecting'
        ? ai.reconnecting
        : ai.connecting;

  // Display only: the cap and the auto-end above are unchanged. With a cap, show what is left, and warn
  // from the last minute, so nobody is cut off mid-answer without notice (accessibility.md › Cognitive).
  const cap = call.maxDurationSeconds && call.maxDurationSeconds > 0 ? call.maxDurationSeconds : null;
  const remaining = cap === null ? null : cap - secs;
  const lastMinute = remaining !== null && remaining <= 60;
  const timeText = remaining === null ? clock(secs) : formatMessage(ai.timeRemaining, { time: clock(remaining) });
  const warning = remaining !== null && remaining <= 0 ? ai.timeUp : lastMinute ? ai.oneMinuteLeft : '';

  return (
    <div className="flex h-dvh flex-col bg-[#0E0A1F] text-white">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-5 py-3 text-callout text-[#cfc8ea]">
        <span className="size-2 shrink-0 rounded-full bg-brand-red" aria-hidden="true" />
        <span className="sr-only">{ai.recording}</span>
        <span className={`tabular-nums ${lastMinute ? 'rounded bg-warning-bg px-1.5 font-semibold text-warning' : ''}`}>{timeText}</span>
        <span aria-hidden="true">·</span>
        <span>{ai.title}</span>
        <span aria-hidden="true">·</span>
        <span role="status">{statusLabel}</span>
      </header>
      <p role="status" className={warning ? 'mx-5 mb-2 rounded-lg bg-warning-bg px-3 py-2 text-callout font-medium text-warning' : 'sr-only'}>
        {warning}
      </p>

      <main className="min-h-0 flex-1 overflow-hidden px-5 pb-4">
        {view === 'call' ? (
          <div className="flex h-full flex-col gap-4 md:flex-row">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex min-h-40 flex-1 items-center justify-center rounded-xl border-2 border-white/20 bg-[#160f2e]">
                <AiOrb state={orbState} size="lg" />
              </div>
              <ParticipantTile name={ai.you} level={call.micMuted ? 0 : 0.4} muted={call.micMuted} />
            </div>
            <div className="flex max-h-[40dvh] w-full flex-col md:max-h-none md:w-[42%]">
              <TranscriptPanel transcript={call.transcript} variant="panel" />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center gap-6 overflow-y-auto pt-8">
            <AiOrb state={orbState} size="lg" />
            <TranscriptPanel transcript={call.transcript} variant="focus" />
          </div>
        )}
      </main>

      <footer className="shrink-0 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <CallControls
          micMuted={call.micMuted}
          onToggleMute={call.toggleMute}
          view={view}
          onToggleView={() => setView((v) => (v === 'call' ? 'focus' : 'call'))}
          onEnd={() => setConfirmingEnd(true)}
        />
      </footer>

      {/* A single-use interview cannot be resumed: one tap on the end control asks first. */}
      {confirmingEnd && (
        <ConfirmDialog
          title={ai.endConfirmTitle}
          description={ai.endConfirmBody}
          confirmLabel={ai.endConfirmAction}
          cancelLabel={ai.endConfirmKeep}
          destructive
          onConfirm={() => {
            setConfirmingEnd(false);
            call.end();
          }}
          onCancel={() => setConfirmingEnd(false)}
        />
      )}
    </div>
  );
}
