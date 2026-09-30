'use client';

import { use, useCallback, useState } from 'react';
import { DailyProvider } from '@daily-co/daily-react';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton } from '../../../../../../components';
import { useI18n } from '../../../../../../lib/i18n';
import { InterviewTopBar } from './interview-top-bar';
import { VideoArea } from './video-area';
import { VideoControls } from './video-controls';
import { ScorecardPanel } from './scorecard-panel';
import { AutoJoin } from './auto-join';
import { JoinErrorPanel } from './join-error-panel';
import { interviewTypeLabel } from './interview-type-label';
import { isVideoInterviewType } from './interview-mode';
import { RoomLobby } from './room-lobby';
import { ScoringStage } from './scoring-stage';
import type { DailyJoinErrorCategory } from './daily-join-error';

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
  const { t } = useI18n();
  const { id } = use(params);
  const [hasJoined, setHasJoined] = useState(false);
  // Scoring never requires video (#325): an evaluator of a video interview can open the
  // scorecard from the lobby or a failed join, without creating a Daily room.
  const [isScoringWithoutVideo, setIsScoringWithoutVideo] = useState(false);

  const interview = trpc.interview.getById.useQuery({ id });

  // Only called on an explicit join — this also creates the room (needs DAILY_API_KEY).
  const videoToken = trpc.interview.createVideoRoom.useMutation();
  const [roomData, setRoomData] = useState<{ url: string; token: string } | null>(null);
  // A failed Daily join used to leave the room on "Conectando..." forever.
  const [joinError, setJoinError] = useState<DailyJoinErrorCategory | null>(null);
  const [joinAttempt, setJoinAttempt] = useState(0);
  const handleJoinError = useCallback((category: DailyJoinErrorCategory) => setJoinError(category), []);

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

  // Retry = fresh token (the old one may be the reason it failed) + a remounted AutoJoin.
  const handleRetryJoin = async () => {
    try {
      const result = await videoToken.mutateAsync({ interviewId: id });
      setRoomData({ url: result.url, token: result.token });
      setJoinError(null);
      setJoinAttempt((n) => n + 1);
    } catch {
      setJoinError('network');
    }
  };

  // Leaves (or never enters) the call: unmounts DailyProvider and keeps only the scorecard.
  const handleScoreWithoutVideo = () => {
    setIsScoringWithoutVideo(true);
    setHasJoined(false);
    setRoomData(null);
    setJoinError(null);
  };

  const handleJoinVideoFromScoring = () => {
    setIsScoringWithoutVideo(false);
    void handleJoin();
  };

  if (interview.isLoading) {
    return <InterviewRoomSkeleton />;
  }

  if (interview.error || !interview.data) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center">
          <p className="text-white text-[14px] mb-2">{t.interviews.couldNotLoadInterview}</p>
          <p className="text-white/50 text-[12px]">{interview.error?.message ?? t.interviews.roomInterviewNotFound}</p>
        </div>
      </div>
    );
  }

  const data = interview.data;
  const candidateName = `${data.candidate.firstName} ${data.candidate.lastName}`;
  const candidateInitials = getInitials(candidateName);
  const subtitle = `${data.vacancy.title} — ${t.interviews.roomTypeLabel} ${interviewTypeLabel(t, data.type)}`;
  const isVideo = isVideoInterviewType(data.type);

  // In-person / phone interviews, or a video interview scored without joining: the
  // scorecard renders directly — no createVideoRoom call and no DailyProvider.
  if (!isVideo || isScoringWithoutVideo) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <InterviewTopBar candidateName={candidateName} vacancyTitle={data.vacancy.title} isInCall={false} />
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <div className="md:flex-[60] flex flex-col bg-[#0a0a0a] min-w-0 shrink-0 md:shrink">
            <ScoringStage
              candidateName={candidateName}
              candidateInitials={candidateInitials}
              subtitle={subtitle}
              location={data.location}
              onJoinVideo={isVideo ? handleJoinVideoFromScoring : undefined}
            />
          </div>
          <ScorecardPanel interview={data} candidateInitials={candidateInitials} />
        </div>
      </div>
    );
  }

  // Pre-join lobby of a video interview
  if (!hasJoined || !roomData) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <InterviewTopBar candidateName={candidateName} vacancyTitle={data.vacancy.title} isInCall={false} />
        <RoomLobby
          candidateName={candidateName}
          candidateInitials={candidateInitials}
          subtitle={subtitle}
          isJoining={videoToken.isPending}
          joinErrorMessage={videoToken.error?.message ?? null}
          onJoin={handleJoin}
          onScoreWithoutVideo={handleScoreWithoutVideo}
        />
      </div>
    );
  }

  // In-call view — DailyProvider only renders with valid url + token
  // avoidEval: load Daily's call-machine bundle via a script tag, which the room
  // route's CSP in lib/security/csp.ts allows, instead of fetch + Function(),
  // which would require 'unsafe-eval' in script-src.
  return (
    <DailyProvider dailyConfig={{ avoidEval: true }}>
      <AutoJoin key={joinAttempt} url={roomData.url} token={roomData.token} onError={handleJoinError} />
      <div className="h-full flex flex-col overflow-hidden">
        <InterviewTopBar
          candidateName={candidateName}
          vacancyTitle={data.vacancy.title}
          isInCall
        />
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <div className="h-[45vh] md:h-auto md:flex-[60] flex flex-col bg-[#0a0a0a] relative min-w-0 shrink-0 md:shrink">
            {joinError ? (
              <JoinErrorPanel category={joinError} onRetry={handleRetryJoin} onScoreWithoutVideo={handleScoreWithoutVideo} />
            ) : (
              <>
                <VideoArea candidateName={candidateName} candidateInitials={candidateInitials} />
                <VideoControls />
              </>
            )}
          </div>
          <ScorecardPanel interview={data} candidateInitials={candidateInitials} />
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
