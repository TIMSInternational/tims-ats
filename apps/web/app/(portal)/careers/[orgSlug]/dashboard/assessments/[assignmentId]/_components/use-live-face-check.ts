import { useCallback, useEffect, useRef, useState } from 'react';
import { createFaceDetector } from '../../../../../../../../lib/proctoring/face-detector';
import { hasLiveVideo } from './proctoring-media';

export type FaceState = 'checking' | 'ok' | 'no_face' | 'multiple_faces' | 'unavailable';

export function useLiveFaceCheck(
  camera: MediaStream | null,
  reportFinding: (type: 'face_missing' | 'multiple_faces' | 'model_unavailable') => void,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const unavailableReportedRef = useRef(false);
  const [observation, setObservation] = useState<{ camera: MediaStream; state: FaceState } | null>(null);
  const faceState: FaceState = !hasLiveVideo(camera)
    ? 'unavailable'
    : observation?.camera === camera
      ? observation.state
      : 'checking';

  const markUnavailable = useCallback(
    (stream: MediaStream) => {
      setObservation({ camera: stream, state: 'unavailable' });
      if (!unavailableReportedRef.current) {
        unavailableReportedRef.current = true;
        reportFinding('model_unavailable');
      }
    },
    [reportFinding],
  );

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = camera;
    if (camera) {
      void element.play().catch(() => markUnavailable(camera));
    }
  }, [camera, markUnavailable]);

  useEffect(() => {
    if (!hasLiveVideo(camera)) return;
    let disposed = false;
    let sampling = false;
    let observedFrame = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let detector: Awaited<ReturnType<typeof createFaceDetector>> | undefined;
    const readinessTimeout = setTimeout(() => {
      if (!disposed && !observedFrame) markUnavailable(camera);
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
                markUnavailable(camera);
                return;
              }
              if (signal.finding === 'no_face') {
                setObservation({ camera, state: 'no_face' });
                reportFinding('face_missing');
              } else if (signal.finding === 'multiple_faces') {
                setObservation({ camera, state: 'multiple_faces' });
                reportFinding('multiple_faces');
              } else setObservation({ camera, state: 'ok' });
            })
            .catch(() => {
              if (!disposed) markUnavailable(camera);
            })
            .finally(() => {
              sampling = false;
            });
        }, 1_000);
      })
      .catch(() => {
        if (!disposed) markUnavailable(camera);
      });
    return () => {
      disposed = true;
      clearTimeout(readinessTimeout);
      if (interval) clearInterval(interval);
      detector?.dispose();
    };
  }, [camera, markUnavailable, reportFinding]);

  return { videoRef, faceState };
}
