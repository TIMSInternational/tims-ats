import { useCallback, useState } from 'react';
import { useConversation, type UseConversationOptions } from '@elevenlabs/react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { applyTranscriptEvent, emptyTranscript, type TranscriptState } from './transcript';

type MessagePayload = Parameters<NonNullable<UseConversationOptions['onMessage']>>[0];

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';

export interface InterviewCall {
  status: CallStatus;
  isAiSpeaking: boolean;
  transcript: TranscriptState;
  micMuted: boolean;
  error: string | null;
  maxDurationSeconds: number | null;
  start: () => Promise<void>;
  end: () => void;
  toggleMute: () => void;
}

export function useInterviewCall(candidateToken: string): InterviewCall {
  const { t } = useI18n();
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript);
  const [error, setError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [maxDurationSeconds, setMaxDurationSeconds] = useState<number | null>(null);

  const conversation = useConversation({
    onConnect: () => setError(null),
    onMessage: (props: MessagePayload) => {
      setTranscript((prev) =>
        applyTranscriptEvent(prev, {
          source: props.source === 'user' ? 'user' : 'ai',
          text: props.message,
          final: true,
        }),
      );
    },
    onDisconnect: () => setEnded(true),
    onError: (message: string) => {
      console.error('[ai-interview] SDK error:', message);
      setError(t.aiInterview.startError);
    },
  });

  const startMutation = trpc.aiInterview.start.useMutation({
    onError: (err) => {
      console.error('[ai-interview] start error:', err.message);
      setError(t.aiInterview.startError);
    },
  });

  const start = useCallback(async () => {
    setError(null);
    setEnded(false);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t.aiInterview.micPermissionError);
      return;
    }
    startMutation.mutate(
      { candidateToken },
      {
        onSuccess: ({ signedUrl, dynamicVariables, maxDurationSeconds: cap }) => {
          setMaxDurationSeconds(cap ?? null);
          void conversation.startSession({ signedUrl, dynamicVariables });
        },
      },
    );
  }, [candidateToken, conversation, startMutation, t]);

  const end = useCallback(() => {
    void conversation.endSession();
  }, [conversation]);

  const toggleMute = useCallback(() => {
    setMicMuted((prev) => {
      const next = !prev;
      // Real @elevenlabs/react@1.7.1 API: setMuted(isMuted: boolean)
      conversation.setMuted(next);
      return next;
    });
  }, [conversation]);

  const status: CallStatus = error
    ? 'error'
    : ended
      ? 'ended'
      : conversation.status === 'connected'
        ? 'connected'
        : conversation.status === 'connecting' || startMutation.isPending
          ? 'connecting'
          : 'idle';

  // Real @elevenlabs/react@1.7.1 API: isSpeaking boolean on useConversation return
  const isAiSpeaking = conversation.isSpeaking && status === 'connected';

  return { status, isAiSpeaking, transcript, micMuted, error, maxDurationSeconds, start, end, toggleMute };
}
