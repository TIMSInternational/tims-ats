'use client';

import {
  DailyVideo,
  useLocalSessionId,
  useParticipantIds,
  useMeetingState,
} from '@daily-co/daily-react';
import { useI18n } from '../../../../../../lib/i18n';

interface VideoAreaProps {
  candidateName: string;
  candidateInitials: string;
}

export function VideoArea({ candidateName, candidateInitials }: VideoAreaProps) {
  const { t } = useI18n();
  const localSessionId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const meetingState = useMeetingState();
  const isJoined = meetingState === 'joined-meeting';
  const mainParticipant = remoteIds[0] ?? null;

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a] relative min-h-0">
      {/* Self video PiP */}
      <div className="absolute top-4 left-4 w-28 h-20 sm:w-[180px] sm:h-[120px] rounded-xl bg-[#1a1a1a] border-2 border-white/20 overflow-hidden z-10 shadow-lg">
        {isJoined && localSessionId ? (
          <DailyVideo
            sessionId={localSessionId}
            mirror
            type="video"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand text-subheading font-semibold text-white" aria-hidden="true">
              {t.interviewRoom.selfTileInitials}
            </div>
          </div>
        )}
        <div className="absolute bottom-1.5 left-2 flex items-center gap-1">
          <svg className="size-3 text-green-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 18.75a6.75 6.75 0 110-13.5 6.75 6.75 0 010 13.5z" />
          </svg>
          <span className="text-caption text-white/70">{t.interviewRoom.selfTileLabel}</span>
        </div>
      </div>

      {/* Connection status overlay */}
      {!isJoined && (
        <div className="absolute top-4 right-4 z-10 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
            <span className="text-caption text-white/70">
              {meetingState === 'joining-meeting' ? t.interviews.roomConnecting : t.interviewRoom.callPreparing}
            </span>
          </div>
        </div>
      )}

      {/* Main video (remote participant) */}
      <div className="flex-1 flex items-center justify-center relative">
        {isJoined && mainParticipant ? (
          <DailyVideo
            sessionId={mainParticipant}
            type="video"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0' }}
          />
        ) : (
          <div className="flex size-32 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#5C4B99]" aria-hidden="true">
            <span className="text-white text-4xl font-bold">{candidateInitials}</span>
          </div>
        )}

        {/* Candidate info overlay */}
        <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
            <span className="text-body text-white font-medium">{candidateName}</span>
          </div>
          <div className="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
            <span className={`text-caption ${isJoined ? 'text-green-400' : 'text-amber-400'}`}>
              {isJoined && mainParticipant ? t.interviewRoom.callStable : isJoined ? t.interviewRoom.callWaitingCandidate : t.interviews.roomConnecting}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
