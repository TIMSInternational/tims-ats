'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../../../../../lib/i18n';
import { stopCandidateProctoringMedia, useHeartbeatCandidateProctoring } from '../../../../../../../../lib/platform-api/proctoring';
import { hasLiveVideo, isEntireScreenShare, stopMedia, type ProctoringMedia } from './proctoring-media';
import { useLiveFaceCheck } from './use-live-face-check';
import { useProctoringEventQueue } from './use-proctoring-event-queue';
import { CandidateMediaEvidenceController, type EvidenceState } from './proctoring-media-evidence';
import { ProctoringEvidenceStatus } from './proctoring-evidence-status';

interface ProctoringMonitorProps {
  orgSlug: string;
  assignmentId: string;
  initialMedia: ProctoringMedia;
  initialPositioningHintsEnabled?: boolean;
  mediaEvidenceConsented?: boolean;
  onMediaChange: (media: ProctoringMedia) => void;
  onRegisterFlush?: (flush: (() => Promise<void>) | null) => void;
  onRegisterMediaEvidenceStop?: (stop: (() => void) | null) => void;
}

export function ProctoringMonitor({ orgSlug, assignmentId, initialMedia, initialPositioningHintsEnabled = false, mediaEvidenceConsented = false, onMediaChange, onRegisterFlush, onRegisterMediaEvidenceStop }: ProctoringMonitorProps) {
  const { t } = useI18n();
  const copy = t.proctoring.candidate;
  const [camera, setCamera] = useState<MediaStream | null>(initialMedia.camera);
  const [screen, setScreen] = useState<MediaStream | null>(initialMedia.screen);
  const [positioningHintsEnabled, setPositioningHintsEnabled] = useState(initialPositioningHintsEnabled);
  const [heartbeatError, setHeartbeatError] = useState(false);
  const [reconnecting, setReconnecting] = useState<'camera' | 'screen' | null>(null);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [mediaEvidenceActive, setMediaEvidenceActive] = useState(mediaEvidenceConsented);
  const [mediaStopSyncError, setMediaStopSyncError] = useState(false);
  const [evidenceState, setEvidenceState] = useState<EvidenceState>({ active: false, uploading: false, failed: false, unavailable: false });
  const cameraRef = useRef<MediaStream | null>(initialMedia.camera);
  const screenRef = useRef<MediaStream | null>(initialMedia.screen);
  const disposedRef = useRef(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evidenceRef = useRef<CandidateMediaEvidenceController | null>(null);
  const { enqueue, flush, syncError } = useProctoringEventQueue(orgSlug, assignmentId);
  const heartbeat = useHeartbeatCandidateProctoring();
  const heartbeatMutateRef = useRef(heartbeat.mutateAsync);

  useEffect(() => {
    heartbeatMutateRef.current = heartbeat.mutateAsync;
  }, [heartbeat.mutateAsync]);
  useEffect(() => {
    onRegisterFlush?.(flush);
    return () => onRegisterFlush?.(null);
  }, [flush, onRegisterFlush]);
  const stopEvidence = useCallback(() => {
    evidenceRef.current?.stop();
    evidenceRef.current = null;
  }, []);
  const persistMediaStop = useCallback(async () => {
    try {
      await stopCandidateProctoringMedia({ orgSlug, assignmentId });
      if (!disposedRef.current) setMediaStopSyncError(false);
    } catch {
      if (!disposedRef.current) setMediaStopSyncError(true);
    }
  }, [assignmentId, orgSlug]);
  useEffect(() => {
    onRegisterMediaEvidenceStop?.(stopEvidence);
    return () => onRegisterMediaEvidenceStop?.(null);
  }, [onRegisterMediaEvidenceStop, stopEvidence]);
  useEffect(() => {
    if (!mediaEvidenceConsented || !mediaEvidenceActive) return;
    const controller = new CandidateMediaEvidenceController(
      { orgSlug, assignmentId },
      { camera: cameraRef.current!, screen: screenRef.current! },
      setEvidenceState,
    );
    evidenceRef.current = controller;
    controller.start();
    return () => {
      controller.stop();
      if (evidenceRef.current === controller) evidenceRef.current = null;
    };
  }, [assignmentId, mediaEvidenceActive, mediaEvidenceConsented, orgSlug]);
  const { videoRef, faceState } = useLiveFaceCheck(camera, positioningHintsEnabled);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        enqueue('tab_hidden');
        evidenceRef.current?.captureEvent('screen');
      }
    };
    const onBlur = () => {
      enqueue('focus_lost');
      evidenceRef.current?.captureEvent('screen');
    };
    const onOnline = () => void flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
    };
  }, [enqueue, flush]);

  useEffect(() => {
    const track = camera?.getVideoTracks()[0];
    if (!track) return;
    const onEnded = () => {
      setCamera(null);
      enqueue('camera_stopped');
      evidenceRef.current?.captureEvent('screen');
    };
    track.addEventListener('ended', onEnded);
    return () => track.removeEventListener('ended', onEnded);
  }, [camera, enqueue]);

  useEffect(() => {
    const track = screen?.getVideoTracks()[0];
    if (!track) return;
    const onEnded = () => {
      setScreen(null);
      enqueue('screen_share_stopped');
      evidenceRef.current?.captureEvent('camera');
    };
    track.addEventListener('ended', onEnded);
    return () => track.removeEventListener('ended', onEnded);
  }, [screen, enqueue]);

  useEffect(() => {
    if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
    disposedRef.current = false;
    return () => {
      // React Strict Mode replays effects on first mount. Give the matching setup
      // a tick to cancel cleanup before stopping a live candidate stream.
      cleanupTimerRef.current = setTimeout(() => {
        disposedRef.current = true;
        stopMedia(cameraRef.current);
        stopMedia(screenRef.current);
      }, 0);
    };
  }, []);

  const sendHeartbeat = useCallback(async () => {
    try {
      await heartbeatMutateRef.current({ orgSlug, assignmentId });
      if (!disposedRef.current) setHeartbeatError(false);
      void flush();
    } catch {
      if (!disposedRef.current) setHeartbeatError(true);
    }
  }, [assignmentId, flush, orgSlug]);

  useEffect(() => {
    const first = setTimeout(() => void sendHeartbeat(), 0);
    const interval = setInterval(() => void sendHeartbeat(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [sendHeartbeat]);

  const reconnect = async (kind: 'camera' | 'screen') => {
    if (reconnecting) return;
    setReconnecting(kind);
    setReconnectError(null);
    try {
      const next =
        kind === 'camera'
          ? await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (disposedRef.current) {
        stopMedia(next);
        return;
      }
      if (!hasLiveVideo(next)) {
        stopMedia(next);
        throw new Error('no_video');
      }
      if (kind === 'screen' && !isEntireScreenShare(next)) {
        stopMedia(next);
        throw new Error('entire_screen_required');
      }
      if (kind === 'camera') {
        stopMedia(cameraRef.current);
        cameraRef.current = next;
        setCamera(next);
      } else {
        stopMedia(screenRef.current);
        screenRef.current = next;
        setScreen(next);
      }
      if (cameraRef.current && screenRef.current)
        {
          const updated = { camera: cameraRef.current, screen: screenRef.current };
          evidenceRef.current?.updateMedia(updated);
          onMediaChange(updated);
        }
    } catch (cause) {
      setReconnectError(
        cause instanceof Error && cause.message === 'entire_screen_required'
          ? copy.screenSurfaceError
          : kind === 'camera'
            ? copy.cameraError
            : copy.screenError,
      );
    } finally {
      setReconnecting(null);
    }
  };

  const cameraLive = hasLiveVideo(camera);
  const screenLive = hasLiveVideo(screen);
  const faceLabel =
    faceState === 'no_face'
      ? copy.faceMissing
      : faceState === 'multiple_faces'
        ? copy.multipleFaces
        : faceState === 'unavailable'
          ? copy.faceUnavailable
          : faceState === 'checking'
            ? copy.faceChecking
            : copy.faceOk;

  return (
    <aside
      aria-label={copy.monitoring}
      className="rounded-xl border border-[#DCD4EC] bg-[#F9F7FC] p-3 space-y-2 text-[12px]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[#493478]">
        <strong>{copy.monitoring}</strong>
        <span role="status">{cameraLive ? copy.cameraLive : copy.cameraLost}</span>
        <span role="status">{screenLive ? copy.screenLive : copy.screenLost}</span>
        {positioningHintsEnabled && <span role="status">{faceLabel}</span>}
        {mediaEvidenceConsented && (
          <span role="status">{evidenceState.active ? copy.mediaEvidenceActive : copy.mediaEvidenceStopped}</span>
        )}
        <span role="status">{syncError || heartbeatError ? copy.syncError : copy.syncOnline}</span>
      </div>
      <ProctoringEvidenceStatus
        consented={mediaEvidenceConsented}
        active={mediaEvidenceActive}
        state={evidenceState}
        onStop={() => {
          stopEvidence();
          setMediaEvidenceActive(false);
          enqueue('media_capture_stopped');
          void persistMediaStop();
        }}
        onRetry={() => evidenceRef.current?.retry()}
      />
      {mediaStopSyncError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[#B42318]">
          <span>{copy.mediaEvidenceStopSyncError}</span>
          <button type="button" onClick={() => void persistMediaStop()} className="underline">
            {copy.mediaEvidenceRetryStop}
          </button>
        </div>
      )}
      <label className="flex items-start gap-2 text-[#585858]">
        <input
          type="checkbox"
          checked={positioningHintsEnabled}
          onChange={(event) => setPositioningHintsEnabled(event.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>{copy.positioningHintsOption}</span>
      </label>
      {(!cameraLive || !screenLive || syncError || heartbeatError) && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          {!cameraLive && (
            <button
              type="button"
              disabled={reconnecting !== null}
              onClick={() => void reconnect('camera')}
              className="rounded-lg border border-[#1F114C] px-3 py-1.5 text-[#1F114C] disabled:opacity-40"
            >
              {copy.reconnectCamera}
            </button>
          )}
          {!screenLive && (
            <button
              type="button"
              disabled={reconnecting !== null}
              onClick={() => void reconnect('screen')}
              className="rounded-lg border border-[#1F114C] px-3 py-1.5 text-[#1F114C] disabled:opacity-40"
            >
              {copy.reconnectScreen}
            </button>
          )}
          {(syncError || heartbeatError) && (
            <button
              type="button"
              onClick={() => void sendHeartbeat()}
              className="rounded-lg border border-[#1F114C] px-3 py-1.5 text-[#1F114C]"
            >
              {copy.retrySync}
            </button>
          )}
          <span className="text-[#985B00]">{copy.reviewNotice}</span>
        </div>
      )}
      {reconnectError && (
        <p role="alert" className="text-[#B42318]">
          {reconnectError}
        </p>
      )}
      {positioningHintsEnabled && (
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-hidden="true"
          className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none"
        />
      )}
    </aside>
  );
}
