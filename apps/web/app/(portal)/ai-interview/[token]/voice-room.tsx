'use client';

import { ConversationProvider } from '@elevenlabs/react';
import { useI18n } from '../../../../lib/i18n';
import { useInterviewCall } from './use-interview-call';
import { Lobby } from './lobby';
import { CallShell } from './call-shell';

function VoiceRoomInner({ candidateToken }: { candidateToken: string }) {
  const { t } = useI18n();
  const call = useInterviewCall(candidateToken);

  if (call.status === 'ended') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0E0A1F] p-4">
        <div className="flex w-full max-w-md flex-col items-center rounded-2xl bg-[#160f2e] p-6 text-center sm:p-8">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-white/10" aria-hidden="true">
            <svg className="size-6 text-[#5fd07a]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" focusable="false">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="font-display text-heading font-semibold text-white">{t.aiInterview.completed}</h1>
          {/* What happens next, and that nothing else is needed here. */}
          <p className="mt-2 text-subheading text-[#cfc8ea]">{t.aiInterview.completedNext}</p>
        </div>
      </main>
    );
  }

  if (call.status === 'connecting' || call.status === 'connected' || call.status === 'reconnecting') {
    return <CallShell call={call} />;
  }

  // idle or error → lobby (error is shown inline on the lobby)
  return <Lobby onJoin={() => void call.start()} joining={false} error={call.error} />;
}

export function VoiceRoom({ candidateToken }: { candidateToken: string }) {
  return (
    <ConversationProvider>
      <VoiceRoomInner candidateToken={candidateToken} />
    </ConversationProvider>
  );
}
