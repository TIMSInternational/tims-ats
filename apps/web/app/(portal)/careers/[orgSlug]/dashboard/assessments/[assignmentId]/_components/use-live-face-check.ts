import { useEffect, useRef, useState } from 'react';
import { createFaceDetector } from '../../../../../../../../lib/proctoring/face-detector';
import { hasLiveVideo } from './proctoring-media';

export type FaceState = 'disabled' | 'checking' | 'ok' | 'no_face' | 'multiple_faces' | 'unavailable';

/** Optional, on-device positioning feedback. Model output never leaves the browser. */
export function useLiveFaceCheck(camera: MediaStream | null, enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [observation, setObservation] = useState<{ camera: MediaStream; state: FaceState } | null>(null);
  const faceState: FaceState = !enabled
    ? 'disabled'
    : !hasLiveVideo(camera)
    ? 'unavailable'
    : observation?.camera === camera
      ? observation.state
      : 'checking';

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = camera;
    if (camera) {
      void element.play().catch(() => setObservation({ camera, state: 'unavailable' }));
    }
  }, [camera, enabled]);

  useEffect(() => {
    if (!enabled || !hasLiveVideo(camera)) return;
    let disposed = false;
    let sampling = false;
    let observedFrame = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let detector: Awaited<ReturnType<typeof createFaceDetector>> | undefined;
    const readinessTimeout = setTimeout(() => {
      if (!disposed && !observedFrame) setObservation({ camera, state: 'unavailable' });
    }, 15_000);
    void createFaceDetector()
      .then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        detector = created;
        interval = setInterval(() => {
          const video = videoRef.current;
          if (!video || !detector || sampling || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          sampling = true;
          void detector
            .sample(video)
            .then((signal) => {
              if (disposed) return;
              observedFrame = true;
              if (signal.status === 'unavailable') {
                setObservation({ camera, state: 'unavailable' });
                return;
              }
              if (signal.finding === 'no_face') {
                setObservation({ camera, state: 'no_face' });
              } else if (signal.finding === 'multiple_faces') {
                setObservation({ camera, state: 'multiple_faces' });
              } else setObservation({ camera, state: 'ok' });
            })
            .catch(() => {
              if (!disposed) setObservation({ camera, state: 'unavailable' });
            })
            .finally(() => {
              sampling = false;
            });
        }, 1_000);
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
  }, [camera, enabled]);

  return { videoRef, faceState };
}
