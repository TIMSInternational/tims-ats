'use client';

import { use, useCallback, useRef, useState, type ReactNode } from 'react';
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
import { isVideoInterview, ROOM_STATUSES } from './interview-mode';
import { RoomLobby } from './room-lobby';
import { ScoringStage } from './scoring-stage';
import { ClosedStage } from './closed-stage';
import { CallStateBridge } from './call-state-bridge';
import type { DailyJoinErrorCategory } from './daily-join-error';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

type Stage = 'lobby' | 'scoring' | 'call';

export default function InterviewRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t } = useI18n();
  const { id } = use(params);

  const interview = trpc.interview.getById.useQuery({ id });

  // Scoring never requires video (#325). null = the default stage for this interview
  // (see below); set once the evaluator switches between lobby, scoring and the call.
  // Never 'call': the call stage is derived from roomData, so clearing roomData is what
  // leaves it, and a superseded token (see joinSeq) is the only thing that could re-enter it.
  const [chosenStage, setChosenStage] = useState<Exclude<Stage, 'call'> | null>(null);
  // Bumped on every switch so the scorecard panel takes focus (a11y).
  const [focusRequest, setFocusRequest] = useState(0);

  // Only called on an explicit join — this also creates the room (needs DAILY_API_KEY).
  const videoToken = trpc.interview.createVideoRoom.useMutation();
  const [roomData, setRoomData] = useState<{ url: string; token: string } | null>(null);
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null);
  // Every join/leave bumps this; a createVideoRoom result from a superseded request is ignored,
  // so a late response can never pull the evaluator back into a call they left.
  const joinSeq = useRef(0);
  // A failed Daily join used to leave the room on "Conectando..." forever.
  const [joinError, setJoinError] = useState<DailyJoinErrorCategory | null>(null);
  const [joinAttempt, setJoinAttempt] = useState(0);
  const handleJoinError = useCallback((category: DailyJoinErrorCategory) => setJoinError(category), []);
  // The top bar sits outside DailyProvider; CallStateBridge reports the call into these.
  const [isCallActive, setIsCallActive] = useState(false);
  const leaveRef = useRef<(() => void) | null>(null);
  const handleLeaveCall = useCallback(() => leaveRef.current?.(), []);

  // Join — creates the room + a token. The current stage stays (and the scorecard stays
  // visible) until the token arrives; a failure is shown on that same stage.
  const handleJoin = async () => {
    const seq = ++joinSeq.current;
    setJoinRequestError(null);
    try {
      const result = await videoToken.mutateAsync({ interviewId: id });
      if (seq !== joinSeq.current) return;
      setRoomData({ url: result.url, token: result.token });
      setJoinError(null);
      setFocusRequest((n) => n + 1);
    } catch (err) {
      if (seq !== joinSeq.current) return;
      setJoinRequestError(err instanceof Error ? err.message : t.interviewRoom.joinErrorUnknown);
    }
  };

  // Retry = fresh token (the old one may be the reason it failed) + a remounted AutoJoin.
  const handleRetryJoin = async () => {
    const seq = ++joinSeq.current;
    try {
      const result = await videoToken.mutateAsync({ interviewId: id });
      if (seq !== joinSeq.current) return;
      setRoomData({ url: result.url, token: result.token });
      setJoinError(null);
      setJoinAttempt((n) => n + 1);
    } catch {
      if (seq === joinSeq.current) setJoinError('network');
    }
  };

  // Leaves (or never enters) the call: DailyProvider unmounts, the scorecard stays mounted.
  const handleScoreWithoutVideo = () => {
    joinSeq.current += 1;
    setChosenStage('scoring');
    setRoomData(null);
    setJoinError(null);
    setJoinRequestError(null);
    setFocusRequest((n) => n + 1);
  };

  const handleJoinVideoFromScoring = () => {
    setRoomData(null);
    void handleJoin();
  };

  if (interview.isLoading) {
    return <InterviewRoomSkeleton />;
  }

  // Only when there is NO data: a failed background refetch (e.g. the getById.invalidate
  // after submitting a scorecard) must not tear down a live call or the unsaved draft.
  if (!interview.data) {
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
  const isVideo = isVideoInterview(data);
  // Any status outside ROOM_STATUSES (cancelled, no_show, ...) closes the room.
  const isRoomClosed = !ROOM_STATUSES.has(data.status);
  const closedMessage =
    data.status === 'cancelled' ? t.interviewRoom.cancelledNotice : t.interviewRoom.closedNotice;
  // Non-video interviews always score directly; a completed video interview starts in
  // scoring too (joining would create a Daily room for a call that is over).
  const stage: Stage = !isVideo
    ? 'scoring'
    : roomData
      ? 'call'
      : (chosenStage ?? (data.status === 'completed' ? 'scoring' : 'lobby'));

  let stageNode: ReactNode;
  let stageClass = 'flex-1 flex flex-col bg-[#0a0a0a] min-w-0';
  const isInCall = stage === 'call' && roomData !== null;
  if (isRoomClosed && !isInCall) {
    stageNode = <ClosedStage candidateName={candidateName} subtitle={subtitle} message={closedMessage} />;
  } else if (stage === 'call' && roomData) {
    stageClass =
      'h-[45vh] md:h-auto md:flex-[60] flex flex-col bg-[#0a0a0a] relative min-w-0 shrink-0 md:shrink';
    // DailyProvider wraps ONLY the video stage, so joining/leaving never remounts the
    // scorecard (its unsaved draft). avoidEval: load Daily's call-machine bundle via a
    // script tag, which the room route's CSP in lib/security/csp.ts allows, instead of
    // fetch + Function(), which would require 'unsafe-eval' in script-src.
    stageNode = (
      <DailyProvider dailyConfig={{ avoidEval: true }}>
        {/* Closed while in the call (e.g. cancelled by someone else): keep the call and its
            controls (yanking the provider would not end it) and say so. */}
        {isRoomClosed && (
          <p role="status" className="absolute top-4 inset-x-4 z-20 bg-black/70 text-white text-[12px] rounded-lg px-3 py-2 text-center">
            {closedMessage}
          </p>
        )}
        <AutoJoin key={joinAttempt} url={roomData.url} token={roomData.token} onError={handleJoinError} />
        <CallStateBridge onCallActiveChange={setIsCallActive} leaveRef={leaveRef} />
        {joinError ? (
          <JoinErrorPanel category={joinError} onRetry={handleRetryJoin} onScoreWithoutVideo={handleScoreWithoutVideo} />
        ) : (
          <>
            <VideoArea candidateName={candidateName} candidateInitials={candidateInitials} />
            <VideoControls />
          </>
        )}
      </DailyProvider>
    );
  } else if (stage === 'scoring') {
    stageClass = 'md:flex-[60] flex flex-col bg-[#0a0a0a] min-w-0 shrink-0 md:shrink';
    stageNode = (
      <ScoringStage
        candidateName={candidateName}
        candidateInitials={candidateInitials}
        subtitle={subtitle}
        location={data.location}
        onJoinVideo={isVideo ? handleJoinVideoFromScoring : undefined}
        isJoining={videoToken.isPending}
        joinErrorMessage={joinRequestError}
      />
    );
  } else {
    stageNode = (
      <RoomLobby
        candidateName={candidateName}
        candidateInitials={candidateInitials}
        subtitle={subtitle}
        isJoining={videoToken.isPending}
        joinErrorMessage={joinRequestError}
        onJoin={handleJoin}
        onScoreWithoutVideo={handleScoreWithoutVideo}
      />
    );
  }

  // ONE stable tree: only the stage above changes between lobby, scoring and call. The
  // scorecard panel keeps its position (hidden, not unmounted, in the lobby).
  const isScorecardVisible = stage !== 'lobby' && !isRoomClosed;
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <InterviewTopBar
        candidateName={candidateName}
        vacancyTitle={data.vacancy.title}
        isCallActive={stage === 'call' && isCallActive}
        onLeaveCall={handleLeaveCall}
      />
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <div className={stageClass}>{stageNode}</div>
        <div className={isScorecardVisible ? 'contents' : 'hidden'} hidden={!isScorecardVisible}>
          <ScorecardPanel interview={data} candidateInitials={candidateInitials} focusRequest={focusRequest} />
        </div>
      </div>
    </div>
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
