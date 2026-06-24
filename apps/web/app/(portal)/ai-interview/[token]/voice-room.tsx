'use client';

import { useState, useCallback } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

interface TranscriptEntry {
  role: 'user' | 'ai';
  message: string;
}

interface VoiceRoomInnerProps {
  candidateToken: string;
}

function VoiceRoomInner({ candidateToken }: VoiceRoomInnerProps) {
  const { t } = useI18n();
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [hasEnded, setHasEnded] = useState(false);

  const startMutation = trpc.aiInterview.start.useMutation({
    onError: (err) => {
      console.error('[ai-interview] start error:', err.message);
      setStartError(t.aiInterview.startError);
      toast(t.aiInterview.startError);
    },
  });

  const conversation = useConversation({
    onConnect: () => setStartError(null),
    onMessage: (props) => {
      setTranscript((prev) => [
        ...prev,
        { role: props.source === 'user' ? 'user' : 'ai', message: props.message },
      ]);
    },
    onDisconnect: () => setHasEnded(true),
    onError: (message) => {
      console.error('[ai-interview] SDK error:', message);
      setStartError(t.aiInterview.startError);
      toast(t.aiInterview.startError);
    },
  });

  const handleStart = useCallback(async () => {
    setStartError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      const msg = t.aiInterview.micPermissionError;
      setStartError(msg);
      toast(msg);
      return;
    }

    startMutation.mutate(
      { candidateToken },
      {
        onSuccess: ({ signedUrl, dynamicVariables }) => {
          conversation.startSession({ signedUrl, dynamicVariables });
        },
      },
    );
  }, [candidateToken, conversation, startMutation, t]);

  const handleEnd = useCallback(() => {
    conversation.endSession();
  }, [conversation]);

  const isConnected = conversation.status === 'connected';
  const isConnecting = conversation.status === 'connecting';

  if (hasEnded && !isConnecting) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full text-center">
          <p className="text-sm text-[#585858]">{t.aiInterview.completed}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isConnected ? 'bg-green-100' : 'bg-[#1F114C]/10'}`}>
            <svg className={`w-5 h-5 ${isConnected ? 'text-green-600' : 'text-[#1F114C]'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#1F114C]">{t.aiInterview.title}</h1>
            {isConnecting && <p className="text-xs text-[#8B8B8B]">{t.aiInterview.connecting}</p>}
            {isConnected && <p className="text-xs text-green-600">{t.aiInterview.connected}</p>}
          </div>
        </div>

        {startError && (
          <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg mb-4">
            {startError}
          </div>
        )}

        {transcript.length > 0 && (
          <div className="mb-6 space-y-2 max-h-60 overflow-y-auto">
            <p className="text-xs font-medium text-[#8B8B8B] uppercase tracking-wide mb-2">
              {t.aiInterview.transcript}
            </p>
            {transcript.map((entry, i) => (
              <div
                key={i}
                className={`text-sm px-3 py-2 rounded-lg ${
                  entry.role === 'user'
                    ? 'bg-[#1F114C]/5 text-[#1F114C] ml-6'
                    : 'bg-[#F8F7FC] text-[#333] mr-6'
                }`}
              >
                {entry.message}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          {!isConnected && !isConnecting && (
            <button
              onClick={handleStart}
              disabled={startMutation.isPending}
              className="flex-1 h-11 rounded-xl bg-[#1F114C] text-white text-sm font-semibold hover:bg-[#2d1a6e] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {startMutation.isPending ? t.aiInterview.loading : t.aiInterview.startInterview}
            </button>
          )}
          {(isConnected || isConnecting) && (
            <button
              onClick={handleEnd}
              className="flex-1 h-11 rounded-xl bg-[#DD0C15] text-white text-sm font-semibold hover:bg-[#b50a11] transition"
            >
              {t.aiInterview.endInterview}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface VoiceRoomProps {
  candidateToken: string;
}

export function VoiceRoom({ candidateToken }: VoiceRoomProps) {
  return (
    <ConversationProvider>
      <VoiceRoomInner candidateToken={candidateToken} />
    </ConversationProvider>
  );
}
