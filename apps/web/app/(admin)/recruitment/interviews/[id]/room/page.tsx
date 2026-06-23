'use client';

import { use, useState } from 'react';
import { DailyProvider } from '@daily-co/daily-react';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton } from '../../../../../../components';
import { InterviewTopBar } from './interview-top-bar';
import { VideoArea } from './video-area';
import { VideoControls } from './video-controls';
import { ScorecardPanel } from './scorecard-panel';
import { AutoJoin } from './auto-join';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function InterviewRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [hasJoined, setHasJoined] = useState(false);

  const interview = trpc.interview.getById.useQuery({ id });

  // Only fetch video token after interview loads — this also creates the room
  const videoToken = trpc.interview.createVideoRoom.useMutation();
  const [roomData, setRoomData] = useState<{ url: string; token: string } | null>(null);

  // Join button handler — creates room + gets token
  const handleJoin = async () => {
    try {
      const result = await videoToken.mutateAsync({ interviewId: id });
      setRoomData({ url: result.url, token: result.token });
      setHasJoined(true);
    } catch {
      // Error handled by mutation state
    }
  };

  if (interview.isLoading) {
    return <InterviewRoomSkeleton />;
  }

  if (interview.error || !interview.data) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center">
          <p className="text-white text-[14px] mb-2">No se pudo cargar la entrevista</p>
          <p className="text-white/50 text-[12px]">{interview.error?.message ?? 'Entrevista no encontrada'}</p>
        </div>
      </div>
    );
  }

  const data = interview.data;
  const candidateName = `${data.candidate.firstName} ${data.candidate.lastName}`;
  const candidateInitials = getInitials(candidateName);

  // Pre-join lobby — show "Join" button before connecting to Daily
  if (!hasJoined || !roomData) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <InterviewTopBar
          candidateName={candidateName}
          vacancyTitle={data.vacancy.title}
          fitScore={87}
          isRecording={false}
        />
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#1F114C] to-[#5C4B99] flex items-center justify-center mx-auto mb-6">
              <span className="text-white text-3xl font-bold">{candidateInitials}</span>
            </div>
            <p className="text-white text-[16px] font-medium mb-1">{candidateName}</p>
            <p className="text-white/50 text-[13px] mb-6">{data.vacancy.title} — Entrevista {data.type}</p>
            <button
              onClick={handleJoin}
              disabled={videoToken.isPending}
              className="bg-[#DD0C15] text-white px-8 py-3 rounded-xl text-[14px] font-medium shadow-[0_4px_16px_rgba(221,12,21,0.3)] hover:bg-[#c00b13] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
            >
              {videoToken.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Conectando...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  Unirse a la entrevista
                </>
              )}
            </button>
            {videoToken.error && (
              <p className="text-red-400 text-[12px] mt-3">{videoToken.error.message}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // In-call view — DailyProvider only renders with valid url + token
  return (
    <DailyProvider>
      <AutoJoin url={roomData.url} token={roomData.token} />
      <div className="h-full flex flex-col overflow-hidden">
        <InterviewTopBar
          candidateName={candidateName}
          vacancyTitle={data.vacancy.title}
          fitScore={87}
          isRecording
        />
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <div className="h-[45vh] md:h-auto md:flex-[60] flex flex-col bg-[#0a0a0a] relative min-w-0 shrink-0 md:shrink">
            <VideoArea candidateName={candidateName} candidateInitials={candidateInitials} />
            <VideoControls />
          </div>
          <ScorecardPanel
            interviewId={data.id}
            candidateName={candidateName}
            candidateInitials={candidateInitials}
            vacancyTitle={data.vacancy.title}
            fitScore={87}
          />
        </div>
      </div>
    </DailyProvider>
  );
}

function InterviewRoomSkeleton() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 h-[50px] bg-[#1F114C] shrink-0">
        <div className="flex items-center gap-3">
          <Skeleton className="w-24 h-3 bg-white/10 rounded" />
          <Skeleton className="w-40 h-3 bg-white/10 rounded" />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-32 h-32 rounded-full bg-[#1a1a1a] animate-pulse" />
      </div>
    </div>
  );
}
