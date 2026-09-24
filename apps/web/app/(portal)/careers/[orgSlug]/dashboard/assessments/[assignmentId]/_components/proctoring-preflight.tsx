'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../../../../../lib/i18n';
import { hasLiveVideo, isEntireScreenShare, stopMedia, type ProctoringMedia } from './proctoring-media';
import { usePreflightFaceCheck } from './use-preflight-face-check';
import { ProctoringConsentOptions } from './proctoring-consent-options';
import { ProctoringPreflightIntro } from './proctoring-preflight-intro';

interface ProctoringPreflightProps {
  isResume: boolean;
  mediaEvidenceAvailable?: boolean;
  mediaEvidenceUnavailableDuration?: boolean;
  onAuthorize: (media: ProctoringMedia, mediaEvidenceOptIn: boolean) => Promise<Date>;
  onReady: (media: ProctoringMedia, startedAt: Date, positioningHintsEnabled: boolean, mediaEvidenceOptIn: boolean) => void;
}

export function ProctoringPreflight({ isResume, mediaEvidenceAvailable = false, mediaEvidenceUnavailableDuration = false, onAuthorize, onReady }: ProctoringPreflightProps) {
  const { t } = useI18n();
  const copy = t.proctoring.candidate;
  const cameraRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const transferredRef = useRef(false);
  const disposedRef = useRef(false);
  const assessmentConsentRef = useRef(false);
  const cameraConsentRef = useRef(false);
  const screenConsentRef = useRef(false);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [assessmentConsent, setAssessmentConsent] = useState(false);
  const [cameraConsent, setCameraConsent] = useState(false);
  const [screenConsent, setScreenConsent] = useState(false);
  const [positioningHintsEnabled, setPositioningHintsEnabled] = useState(false);
  const [mediaEvidenceOptIn, setMediaEvidenceOptIn] = useState(false);
  const [busy, setBusy] = useState<'camera' | 'screen' | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { videoRef, faceCheck } = usePreflightFaceCheck(camera, positioningHintsEnabled);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (!transferredRef.current) {
        stopMedia(cameraRef.current);
        stopMedia(screenRef.current);
      }
    };
  }, []);

  const disconnectCamera = () => {
    stopMedia(cameraRef.current);
    cameraRef.current = null;
    setCamera(null);
  };

  const disconnectScreen = () => {
    stopMedia(screenRef.current);
    screenRef.current = null;
    setScreen(null);
  };

  const enableCamera = async () => {
    if (!assessmentConsent || !cameraConsent || busy) return;
    setBusy('camera');
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const next = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (disposedRef.current || !assessmentConsentRef.current || !cameraConsentRef.current) {
        stopMedia(next);
        return;
      }
      if (!hasLiveVideo(next)) {
        stopMedia(next);
        throw new Error('no_video');
      }
      stopMedia(cameraRef.current);
      cameraRef.current = next;
      setCamera(next);
      next.getVideoTracks()[0]?.addEventListener(
        'ended',
        () => {
          if (cameraRef.current === next) setCamera(null);
        },
        { once: true },
      );
    } catch {
      setError(copy.cameraError);
    } finally {
      setBusy(null);
    }
  };

  const enableScreen = async () => {
    if (!assessmentConsent || !screenConsent || busy) return;
    setBusy('screen');
    setError(null);
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('unsupported');
      const next = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (disposedRef.current || !assessmentConsentRef.current || !screenConsentRef.current) {
        stopMedia(next);
        return;
      }
      if (!hasLiveVideo(next)) {
        stopMedia(next);
        throw new Error('no_video');
      }
      if (!isEntireScreenShare(next)) {
        stopMedia(next);
        throw new Error('entire_screen_required');
      }
      stopMedia(screenRef.current);
      screenRef.current = next;
      setScreen(next);
      next.getVideoTracks()[0]?.addEventListener(
        'ended',
        () => {
          if (screenRef.current === next) setScreen(null);
        },
        { once: true },
      );
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'entire_screen_required'
          ? copy.screenSurfaceError
          : copy.screenError,
      );
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    const currentCamera = cameraRef.current;
    const currentScreen = screenRef.current;
    if (
      !assessmentConsent ||
      !cameraConsent ||
      !screenConsent ||
      !hasLiveVideo(currentCamera) ||
      !hasLiveVideo(currentScreen) ||
      busy
    )
      return;
    setBusy('start');
    setError(null);
    try {
      const media = { camera: currentCamera, screen: currentScreen };
      const optedIn = mediaEvidenceAvailable && mediaEvidenceOptIn;
      const startedAt = await onAuthorize(media, optedIn);
      transferredRef.current = true;
      onReady(media, startedAt, positioningHintsEnabled, optedIn);
    } catch {
      setError(copy.startError);
    } finally {
      setBusy(null);
    }
  };

  const cameraReady = hasLiveVideo(camera);
  const screenReady = hasLiveVideo(screen);
  const faceStatus =
    faceCheck === 'ready'
      ? copy.faceReady
      : faceCheck === 'missing'
        ? copy.faceMissing
        : faceCheck === 'multiple'
          ? copy.multipleFaces
          : faceCheck === 'unavailable'
            ? copy.preflightFaceUnavailable
            : copy.faceChecking;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <section
        className="bg-white rounded-2xl shadow-lg p-6 md:p-8 max-w-xl w-full space-y-5"
        aria-labelledby="proctoring-title"
      >
        <ProctoringPreflightIntro isResume={isResume} />
        <ProctoringConsentOptions
          mediaEvidenceAvailable={mediaEvidenceAvailable}
          mediaEvidenceUnavailableDuration={mediaEvidenceUnavailableDuration}
          mediaEvidenceOptIn={mediaEvidenceOptIn}
          assessmentConsent={assessmentConsent}
          disabled={busy === 'start'}
          onMediaOptInChange={setMediaEvidenceOptIn}
          onAssessmentConsentChange={(accepted) => {
            assessmentConsentRef.current = accepted;
            setAssessmentConsent(accepted);
            if (!accepted) {
              disconnectCamera();
              disconnectScreen();
            }
          }}
        />
        <div className="rounded-xl border border-[#E5E5E5] p-4 space-y-3">
          <label className="flex items-start gap-3 text-[13px] text-[#444]">
            <input
              type="checkbox"
              checked={cameraConsent}
              onChange={(event) => {
                cameraConsentRef.current = event.target.checked;
                setCameraConsent(event.target.checked);
                if (!event.target.checked) disconnectCamera();
              }}
              disabled={busy === 'start'}
              className="mt-0.5 h-4 w-4"
            />
            <span>{copy.cameraConsent}</span>
          </label>
          <button
            type="button"
            disabled={!assessmentConsent || !cameraConsent || busy !== null}
            onClick={enableCamera}
            className="rounded-lg border border-[#1F114C] px-4 py-2 text-[13px] text-[#1F114C] disabled:opacity-40"
          >
            {busy === 'camera' ? copy.checking : cameraReady ? copy.retryCamera : copy.enableCamera}
          </button>
          <p className="text-[12px] text-[#585858]" role="status">
            {cameraReady ? copy.cameraReady : copy.cameraNotReady}
          </p>
          <label className="flex items-start gap-3 text-[12px] text-[#585858]">
            <input
              type="checkbox"
              checked={positioningHintsEnabled}
              onChange={(event) => setPositioningHintsEnabled(event.target.checked)}
              disabled={!cameraReady || busy === 'start'}
              className="mt-0.5 h-4 w-4"
            />
            <span>{copy.positioningHintsOption}</span>
          </label>
          {cameraReady && positioningHintsEnabled && (
            <p className="text-[12px] text-[#585858]" role="status">
              {faceStatus}
            </p>
          )}
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label={copy.cameraPreview}
            className={`aspect-video w-48 rounded-lg bg-[#1C1C1C] object-cover -scale-x-100 ${cameraReady ? '' : 'hidden'}`}
          />
        </div>
        <div className="rounded-xl border border-[#E5E5E5] p-4 space-y-3">
          <label className="flex items-start gap-3 text-[13px] text-[#444]">
            <input
              type="checkbox"
              checked={screenConsent}
              onChange={(event) => {
                screenConsentRef.current = event.target.checked;
                setScreenConsent(event.target.checked);
                if (!event.target.checked) disconnectScreen();
              }}
              disabled={busy === 'start'}
              className="mt-0.5 h-4 w-4"
            />
            <span>{copy.screenConsent}</span>
          </label>
          <button
            type="button"
            disabled={!assessmentConsent || !screenConsent || busy !== null}
            onClick={enableScreen}
            className="rounded-lg border border-[#1F114C] px-4 py-2 text-[13px] text-[#1F114C] disabled:opacity-40"
          >
            {busy === 'screen' ? copy.checking : screenReady ? copy.retryScreen : copy.enableScreen}
          </button>
          <p className="text-[12px] text-[#585858]" role="status">
            {screenReady ? copy.screenReady : copy.screenNotReady}
          </p>
        </div>
        <p className="text-[12px] text-[#585858] leading-relaxed">{copy.accommodationHelp}</p>
        {error && (
          <p role="alert" className="text-[12px] text-[#B42318]">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={
            !assessmentConsent ||
            !cameraConsent ||
            !screenConsent ||
            !cameraReady ||
            !screenReady ||
            busy !== null
          }
          onClick={start}
          className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === 'start' ? copy.starting : isResume ? copy.resume : copy.start}
        </button>
      </section>
    </div>
  );
}
