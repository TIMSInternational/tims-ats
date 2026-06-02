'use client';

import { use } from 'react';
import { DailyProvider } from '@daily-co/daily-react';
import { trpc } from '../../../../../../lib/trpc';
import { InterviewTopBar } from './interview-top-bar';
import { VideoArea } from './video-area';
import { VideoControls } from './video-controls';
import { ScorecardPanel } from './scorecard-panel';

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

  const interview = trpc.interview.getById.useQuery({ id });
  const videoToken = trpc.interview.getVideoToken.useQuery(
    { interviewId: id },
    { enabled: !!interview.data },
  );

  if (interview.isLoading || videoToken.isLoading) {
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
  const roomUrl = videoToken.data?.url;
  const token = videoToken.data?.token;

  return (
    <DailyProvider url={roomUrl} token={token}>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Top bar */}
        <InterviewTopBar
          candidateName={candidateName}
          vacancyTitle={data.vacancy.title}
          fitScore={87}
          isRecording
        />

        {/* Split view */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Video (60%) */}
          <div className="flex-[60] flex flex-col bg-[#0a0a0a] relative min-w-0">
            <VideoArea
              candidateName={candidateName}
              candidateInitials={candidateInitials}
            />
            <VideoControls />
          </div>

          {/* Right: Scorecard (40%) */}
          <ScorecardPanel
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
      {/* Top bar skeleton */}
      <div className="flex items-center justify-between px-6 h-[50px] bg-[#1F114C] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-24 h-3 bg-white/10 rounded animate-pulse" />
          <div className="w-40 h-3 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-3 bg-white/10 rounded animate-pulse" />
          <div className="w-20 h-8 bg-white/10 rounded-lg animate-pulse" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Video skeleton */}
        <div className="flex-[60] flex flex-col bg-[#0a0a0a]">
          <div className="flex-1 flex items-center justify-center">
            <div className="w-32 h-32 rounded-full bg-[#1a1a1a] animate-pulse" />
          </div>
          <div className="flex items-center justify-center gap-3 py-3 bg-[#111]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
            ))}
          </div>
        </div>

        {/* Scorecard skeleton */}
        <div className="flex-[40] flex flex-col bg-white border-l border-[#EDEDED]">
          <div className="flex border-b border-[#EDEDED] p-3 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex-1 h-4 bg-[#F6F6F6] rounded animate-pulse" />
            ))}
          </div>
          <div className="p-4 space-y-4">
            <div className="h-16 bg-[#F6F6F6] rounded-lg animate-pulse" />
            <div className="h-24 bg-[#F6F6F6] rounded-lg animate-pulse" />
            <div className="h-24 bg-[#F6F6F6] rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
