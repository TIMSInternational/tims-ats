import { hasLiveVideo, isEntireScreenShare, type ProctoringMedia } from './proctoring-media';
import type { CandidateMediaType } from '../../../../../../../../lib/platform-api/proctoring';

const MAX_EDGE = { camera: 1280, screen: 1600 } as const;
const MAX_BYTES = { camera: 2 * 1024 * 1024, screen: 4 * 1024 * 1024 } as const;
const FRAME_TIMEOUT_MS = 5_000;

function abortable<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('capture_cancelled')); return; }
    const timeout = setTimeout(() => finish(() => reject(new Error('capture_timeout'))), timeoutMs);
    const onAbort = () => finish(() => reject(new Error('capture_cancelled')));
    const finish = (settle: () => void) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error)));
  });
}

function jpegBlob(canvas: HTMLCanvasElement, quality: number, signal: AbortSignal): Promise<Blob> {
  return abortable(new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('capture_encode_failed')), 'image/jpeg', quality);
  }), signal, FRAME_TIMEOUT_MS);
}

/** Capture a bounded still from an already-consented, live local track. */
export async function captureProctoringStill(
  media: ProctoringMedia,
  kind: CandidateMediaType,
  signal: AbortSignal,
): Promise<Blob> {
  const stream = media[kind];
  if (!hasLiveVideo(stream) || (kind === 'screen' && !isEntireScreenShare(stream)))
    throw new Error('capture_track_unavailable');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await abortable(video.play(), signal, FRAME_TIMEOUT_MS);
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await abortable(new Promise<void>((resolve) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
      }), signal, FRAME_TIMEOUT_MS);
    }
    if (!hasLiveVideo(stream) || (kind === 'screen' && !isEntireScreenShare(stream)))
      throw new Error('capture_track_unavailable');
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth < 64 || sourceHeight < 64 || sourceWidth > 8192 || sourceHeight > 8192)
      throw new Error('capture_dimensions_invalid');
    const initialScale = Math.min(1, MAX_EDGE[kind] / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('capture_canvas_unavailable');
    for (const shrink of [1, 0.8, 0.64]) {
      canvas.width = Math.max(64, Math.round(sourceWidth * initialScale * shrink));
      canvas.height = Math.max(64, Math.round(sourceHeight * initialScale * shrink));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.65, 0.5]) {
        const blob = await jpegBlob(canvas, quality, signal);
        if (blob.size > 0 && blob.size <= MAX_BYTES[kind]) return blob;
      }
    }
    throw new Error('capture_too_large');
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
