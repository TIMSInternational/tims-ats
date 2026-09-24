/**
 * Advisory, on-device face-count signals for an assessment camera stream.
 *
 * MediaPipe BlazeFace detects prominent, front-facing faces; it cannot verify
 * identity, intent, or whether misconduct occurred. Never upload frames,
 * landmarks, bounding boxes, or detection scores from this module.
 */

export type FaceFinding = "no_face" | "multiple_faces";

export type FaceSignal =
  | {
      status: "ok";
      faceCount: number;
      finding: FaceFinding | null;
      /** Time of the most recent inference, in the caller's monotonic clock. */
      sampledAtMs: number;
    }
  | {
      status: "unavailable";
      finding: null;
      sampledAtMs: number;
    };

export interface FaceDetector {
  /**
   * Samples at most once per second, even if the caller invokes this more often.
   * A finding requires three consecutive fresh frames with the same condition.
   * Returns the last signal between samples; use sampledAtMs to identify fresh
   * observations. Model, camera, and frame failures return `unavailable`, never
   * a false `no_face` finding.
   */
  sample(video: HTMLVideoElement, nowMs?: number): Promise<FaceSignal>;
  dispose(): void;
}

const MIN_SAMPLE_INTERVAL_MS = 1_000;
const STALE_FRAME_MS = 3_000;
const FINDING_CONFIRMATION_SAMPLES = 3;
const WASM_PATH = "/proctoring/wasm";
const MODEL_PATH = "/proctoring/blaze_face_short_range.float16.v1.tflite";

function clockNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function unavailable(sampledAtMs: number): FaceSignal {
  return { status: "unavailable", finding: null, sampledAtMs };
}

/** Suppresses single-frame detection jitter without retaining any image data. */
export class FaceFindingHysteresis {
  private candidate: FaceFinding | null = null;
  private consecutive = 0;

  observe(faceCount: number): FaceFinding | null {
    const finding: FaceFinding | null =
      faceCount === 0 ? "no_face" : faceCount > 1 ? "multiple_faces" : null;

    if (finding === null) {
      this.reset();
      return null;
    }

    if (finding !== this.candidate) {
      this.candidate = finding;
      this.consecutive = 1;
    } else {
      this.consecutive += 1;
    }

    return this.consecutive >= FINDING_CONFIRMATION_SAMPLES ? finding : null;
  }

  reset(): void {
    this.candidate = null;
    this.consecutive = 0;
  }
}

type MediaPipeDetector = {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { detections: readonly unknown[] };
  close(): void;
};

class BrowserFaceDetector implements FaceDetector {
  private readonly hysteresis = new FaceFindingHysteresis();
  private lastSignal: FaceSignal = unavailable(0);
  private lastInferenceAtMs = Number.NEGATIVE_INFINITY;
  private lastVideoTime = Number.NEGATIVE_INFINITY;
  private lastDetectorTimestampMs = Number.NEGATIVE_INFINITY;
  private isDisposed = false;
  private isFailed = false;
  private isModelClosed = false;

  constructor(private readonly detector: MediaPipeDetector) {}

  async sample(video: HTMLVideoElement, nowMs = clockNow()): Promise<FaceSignal> {
    const time = Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : clockNow();
    if (
      this.isDisposed ||
      this.isFailed ||
      !video ||
      video.readyState < 2 ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0 ||
      video.paused ||
      video.ended
    ) {
      this.hysteresis.reset();
      this.lastSignal = unavailable(time);
      return this.lastSignal;
    }

    if (time - this.lastInferenceAtMs < MIN_SAMPLE_INTERVAL_MS) {
      return this.lastSignal;
    }

    // A frozen or stalled video must not reinforce a finding. One brief repeat
    // is normal when the browser has not delivered the next decoded frame yet.
    if (video.currentTime < this.lastVideoTime) {
      // A replaced stream or a seek restarts the video clock.
      this.lastVideoTime = Number.NEGATIVE_INFINITY;
      this.hysteresis.reset();
    } else if (video.currentTime === this.lastVideoTime) {
      if (time - this.lastInferenceAtMs >= STALE_FRAME_MS) {
        this.hysteresis.reset();
        this.lastSignal = unavailable(time);
      }
      return this.lastSignal;
    }

    this.lastInferenceAtMs = time;
    this.lastVideoTime = video.currentTime;
    const timestampMs = Math.max(time, this.lastDetectorTimestampMs + 1);
    this.lastDetectorTimestampMs = timestampMs;

    try {
      const result = this.detector.detectForVideo(video, timestampMs);
      const faceCount = result.detections.length;
      this.lastSignal = {
        status: "ok",
        faceCount,
        finding: this.hysteresis.observe(faceCount),
        sampledAtMs: time,
      };
    } catch {
      // An inference error is not evidence that no face is present.
      this.isFailed = true;
      this.hysteresis.reset();
      this.lastSignal = unavailable(time);
      this.closeModel();
    }

    return this.lastSignal;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.hysteresis.reset();
    this.closeModel();
  }

  private closeModel(): void {
    if (this.isModelClosed) return;
    this.isModelClosed = true;
    try {
      this.detector.close();
    } catch {
      // Disposal must not interrupt assessment cleanup.
    }
  }
}

class UnavailableFaceDetector implements FaceDetector {
  async sample(_video: HTMLVideoElement, nowMs = clockNow()): Promise<FaceSignal> {
    return unavailable(Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : clockNow());
  }

  dispose(): void {}
}

/**
 * Initializes the self-hosted MediaPipe Tasks Vision 1.0.1 runtime and Google's
 * Apache-2.0 BlazeFace short-range float16 model. If initialization fails,
 * `sample()` reports `unavailable`; assessment policy decides how to proceed.
 */
async function loadMediaPipeDetector(): Promise<MediaPipeDetector> {
  // Import after camera consent so the 1.0.1 bundle is not part of ordinary
  // navigation, and so server rendering never evaluates its browser runtime.
  const { FaceDetector: MediaPipeFaceDetector, FilesetResolver } = await import(
    "@mediapipe/tasks-vision"
  );
  const wasm = await FilesetResolver.forVisionTasks(WASM_PATH);
  return MediaPipeFaceDetector.createFromOptions(wasm, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
    minSuppressionThreshold: 0.3,
  });
}

export async function createFaceDetector(
  loadDetector: () => Promise<MediaPipeDetector> = loadMediaPipeDetector,
): Promise<FaceDetector> {
  if (typeof window === "undefined") return new UnavailableFaceDetector();

  try {
    const detector = await loadDetector();
    return new BrowserFaceDetector(detector);
  } catch {
    return new UnavailableFaceDetector();
  }
}
