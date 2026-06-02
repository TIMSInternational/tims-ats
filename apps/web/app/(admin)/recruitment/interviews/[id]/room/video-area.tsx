'use client';

import {
  DailyVideo,
  useLocalSessionId,
  useParticipantIds,
  useDaily,
} from '@daily-co/daily-react';

interface VideoAreaProps {
  candidateName: string;
  candidateInitials: string;
}

export function VideoArea({ candidateName, candidateInitials }: VideoAreaProps) {
  const daily = useDaily();
  const localSessionId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const mainParticipant = remoteIds[0] ?? null;
  const isJoined = !!daily && !!localSessionId;

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a] relative min-h-0">
      {/* Self video PiP */}
      <div className="absolute top-4 left-4 w-[180px] h-[120px] rounded-xl bg-[#1a1a1a] border-2 border-white/20 overflow-hidden z-10 shadow-lg">
        {isJoined && localSessionId ? (
          <DailyVideo
            sessionId={localSessionId}
            mirror
            type="video"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-[#DD0C15] flex items-center justify-center text-white text-[14px] font-bold">
              Tu
            </div>
          </div>
        )}
        <div className="absolute bottom-1.5 left-2 flex items-center gap-1">
          <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 18.75a6.75 6.75 0 110-13.5 6.75 6.75 0 010 13.5z" />
          </svg>
          <span className="text-[9px] text-white/70">Tu</span>
        </div>
      </div>

      {/* Main video (remote participant) */}
      <div className="flex-1 flex items-center justify-center relative">
        {mainParticipant ? (
          <DailyVideo
            sessionId={mainParticipant}
            type="video"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '0',
            }}
          />
        ) : (
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#1F114C] to-[#5C4B99] flex items-center justify-center">
            <span className="text-white text-4xl font-bold">{candidateInitials}</span>
          </div>
        )}

        {/* Candidate info overlay */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
          <div className="flex items-center gap-3 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
            <span className="text-[13px] text-white font-medium">{candidateName}</span>
          </div>
          <div className="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
            <span className="text-[11px] text-green-400">
              {mainParticipant ? 'Conexion estable' : 'Esperando candidato...'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
