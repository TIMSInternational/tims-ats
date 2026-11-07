'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DailyAudio,
  DailyProvider,
  DailyVideo,
  useDaily,
  useDailyEvent,
  useLocalSessionId,
  useMeetingState,
  useParticipantIds,
  useTranscription,
} from '@daily-co/daily-react';
import { useI18n } from '../../../../lib/i18n';
import { splitJoinUrl, type RecordingConsentDecision } from '../../../../lib/interview-join';

interface CandidateCallProps {
  joinUrl: string;
  /** What the candidate answered on the notice, or null when transcription is off for this deployment. */
  decision: RecordingConsentDecision | null;
  /** Re-runs the join check (fresh token) after leaving or a failed connection. */
  onRejoin: () => void;
}

/**
 * The candidate's in-platform video call (in-app video ON). The call object is created here (CSP allows Daily's
 * bundle on this route only while in-app video is on) and destroyed on unmount, so leaving the page always
 * releases camera and microphone. A failure offers the same room in a new tab.
 */
export function CandidateCall(props: CandidateCallProps) {
  return (
    <DailyProvider dailyConfig={{ avoidEval: true }}>
      <CandidateCallStage {...props} />
    </DailyProvider>
  );
}

type Phase = 'joining' | 'joined' | 'left' | 'error';

function CandidateCallStage({ joinUrl, decision, onRejoin }: CandidateCallProps) {
  const { t } = useI18n();
  const copy = t.interviewJoinTranscription;
  const daily = useDaily();
  const meetingState = useMeetingState();
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const { isTranscribing } = useTranscription();
  const [phase, setPhase] = useState<Phase>('joining');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const tried = useRef(false);

  useDailyEvent(
    'error',
    useCallback(() => setPhase('error'), []),
  );
  useDailyEvent(
    'left-meeting',
    useCallback(() => setPhase((p) => (p === 'error' ? p : 'left')), []),
  );
  useDailyEvent(
    'joined-meeting',
    useCallback(() => setPhase('joined'), []),
  );

  useEffect(() => {
    if (!daily || tried.current) return;
    if (meetingState !== 'new' && meetingState !== 'loaded') return;
    tried.current = true;
    const { url, token } = splitJoinUrl(joinUrl);
    daily.join(token ? { url, token } : { url }).catch(() => setPhase('error'));
  }, [daily, meetingState, joinUrl]);

  // daily-react's provider does not destroy the call object on unmount; without this the camera stays live.
  // Deferred one tick (as the staff room's CallStateBridge) so StrictMode's simulated unmount keeps the call.
  const pendingDestroy = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingDestroy.current) clearTimeout(pendingDestroy.current);
    pendingDestroy.current = null;
    return () => {
      if (!daily) return;
      pendingDestroy.current = setTimeout(() => {
        if (!daily.isDestroyed()) void daily.destroy().catch(() => undefined);
      }, 0);
    };
  }, [daily]);

  const toggleMic = () => {
    if (!daily) return;
    daily.setLocalAudio(!micOn);
    setMicOn(!micOn);
  };
  const toggleCam = () => {
    if (!daily) return;
    daily.setLocalVideo(!camOn);
    setCamOn(!camOn);
  };
  const leave = () => {
    if (daily) void daily.leave().catch(() => undefined);
    setPhase('left');
  };

  if (phase === 'error' || phase === 'left') {
    const isError = phase === 'error';
    return (
      <section className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm" aria-live="polite">
        <h1 className="text-xl font-semibold text-[#1F114C]">{isError ? copy.callErrorTitle : copy.leftTitle}</h1>
        <p className="mt-3 text-sm text-slate-600">{isError ? copy.callErrorText : copy.leftText}</p>
        <button
          type="button"
          onClick={onRejoin}
          className="mt-6 w-full rounded-xl bg-[#1F114C] px-4 py-3 text-sm font-semibold text-white hover:bg-violet-900 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          {copy.rejoin}
        </button>
        {isError && (
          // A plain link: the room URL is already validated as a Daily hosted page (isSafeDailyJoinUrl).
          <a
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="mt-3 block text-sm font-medium text-[#1F114C] underline"
          >
            {copy.openInNewTab}
          </a>
        )}
      </section>
    );
  }

  const main = remoteIds[0];
  const btn =
    'rounded-full px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white';
  return (
    <section className="flex h-[100dvh] w-full flex-col bg-[#0a0a0a]" aria-label={t.interviewJoin.title}>
      {decision && (
        <p role="status" className="bg-[#1F114C] px-4 py-2 text-center text-xs text-white">
          {decision === 'accepted' ? copy.acceptedNote : copy.declinedNote}
          {isTranscribing && (
            <span className="ml-2 inline-flex items-center gap-1 font-semibold">
              <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              {copy.live}
            </span>
          )}
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        {main ? (
          <DailyVideo sessionId={main} type="video" fit="cover" className="h-full w-full" />
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-white/70" role="status">
            {phase === 'joining' ? copy.joining : copy.waiting}
          </p>
        )}
        {localId && (
          <div className="absolute bottom-4 right-4 h-28 w-40 overflow-hidden rounded-xl border-2 border-white/20 bg-[#1a1a1a]">
            <DailyVideo sessionId={localId} type="video" fit="cover" mirror className="h-full w-full" />
            <span className="absolute bottom-1 left-2 text-[10px] text-white/80">{copy.you}</span>
          </div>
        )}
      </div>
      <DailyAudio />
      <div className="flex items-center justify-center gap-3 bg-[#111] py-3">
        <button
          type="button"
          onClick={toggleMic}
          disabled={phase !== 'joined'}
          className={`${btn} ${micOn ? 'bg-white/10 text-white' : 'bg-red-600 text-white'}`}
        >
          {micOn ? copy.micOff : copy.micOn}
        </button>
        <button
          type="button"
          onClick={toggleCam}
          disabled={phase !== 'joined'}
          className={`${btn} ${camOn ? 'bg-white/10 text-white' : 'bg-red-600 text-white'}`}
        >
          {camOn ? copy.camOff : copy.camOn}
        </button>
        <button type="button" onClick={leave} className={`${btn} bg-[#DD0C15] text-white`}>
          {copy.leave}
        </button>
      </div>
    </section>
  );
}
