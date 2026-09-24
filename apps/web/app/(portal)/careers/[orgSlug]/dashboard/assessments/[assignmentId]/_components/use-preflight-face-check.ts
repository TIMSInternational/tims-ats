import { useEffect, useRef, useState } from 'react';
import { createFaceDetector } from '../../../../../../../../lib/proctoring/face-detector';
import { hasLiveVideo } from './proctoring-media';

export type PreflightFaceCheck = 'waiting' | 'checking' | 'ready' | 'missing' | 'multiple' | 'unavailable';

export function usePreflightFaceCheck(camera: MediaStream | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [observation, setObservation] = useState<{ camera: MediaStream; state: PreflightFaceCheck } | null>(null);
  const faceCheck: PreflightFaceCheck = !hasLiveVideo(camera)
    ? 'waiting'
    : observation?.camera === camera
      ? observation.state
      : 'checking';

  useEffect(() => {
    const element = videoRef.current;
    if (element) {
      element.srcObject = camera;
      if (camera) void element.play().catch(() => setObservation({ camera, state: 'unavailable' }));
    }
  }, [camera]);

  useEffect(() => {
    if (!hasLiveVideo(camera)) return;
    let disposed = false;
    let sampling = false;
    let singleFaceSamples = 0;
    let lastSampledAt = -1;
    let interval: ReturnType<typeof setInterval> | undefined;
    let detector: Awaited<ReturnType<typeof createFaceDetector>> | undefined;
    const readinessTimeout = setTimeout(() => {
      if (!disposed && lastSampledAt < 0) setObservation({ camera, state: 'unavailable' });
    }, 15_000);
    void createFaceDetector()
      .then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        detector = created;
        const check = async () => {
          const video = videoRef.current;
          if (sampling || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !detector) return;
          sampling = true;
          try {
            const signal = await detector.sample(video);
            if (disposed) return;
            if (signal.sampledAtMs === lastSampledAt) return;
            lastSampledAt = signal.sampledAtMs;
            if (signal.status === 'unavailable' || signal.faceCount === undefined) {
              singleFaceSamples = 0;
              setObservation({ camera, state: 'unavailable' });
            } else if (signal.faceCount === 1) {
              singleFaceSamples += 1;
              setObservation({ camera, state: singleFaceSamples >= 3 ? 'ready' : 'checking' });
            } else {
              singleFaceSamples = 0;
              setObservation({ camera, state: signal.faceCount > 1 ? 'multiple' : 'missing' });
            }
          } catch {
            if (!disposed) {
              singleFaceSamples = 0;
              setObservation({ camera, state: 'unavailable' });
            }
          } finally {
            sampling = false;
          }
        };
        void check();
        interval = setInterval(() => void check(), 1_000);
      })
      .catch(() => {
        if (!disposed) setObservation({ camera, state: 'unavailable' });
      });
    return () => {
      disposed = true;
      clearTimeout(readinessTimeout);
      if (interval) clearInterval(interval);
      detector?.dispose();
    };
  }, [camera]);

  return { videoRef, faceCheck };
}
