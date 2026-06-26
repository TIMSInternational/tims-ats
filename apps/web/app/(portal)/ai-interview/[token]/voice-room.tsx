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
      <div className="min-h-screen bg-[#0E0A1F] flex items-center justify-center p-4">
        <div className="rounded-2xl bg-[#160f2e] p-8 max-w-md w-full text-center">
          <p className="text-sm text-[#cfc8ea]">{t.aiInterview.completed}</p>
        </div>
      </div>
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
