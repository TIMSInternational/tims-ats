import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createFaceDetector,
  FaceFindingHysteresis,
} from "../../apps/web/lib/proctoring/face-detector";

function videoFrame(): HTMLVideoElement {
  return {
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    paused: false,
    ended: false,
    currentTime: 0,
  } as HTMLVideoElement;
}

describe("FaceFindingHysteresis", () => {
  it("confirms only three consecutive missing or multiple-face observations", () => {
    const filter = new FaceFindingHysteresis();
    expect(filter.observe(0)).toBeNull();
    expect(filter.observe(0)).toBeNull();
    expect(filter.observe(1)).toBeNull();
    expect(filter.observe(0)).toBeNull();
    expect(filter.observe(0)).toBeNull();
    expect(filter.observe(0)).toBe("no_face");
    expect(filter.observe(2)).toBeNull();
    expect(filter.observe(2)).toBeNull();
    expect(filter.observe(2)).toBe("multiple_faces");
    expect(filter.observe(1)).toBeNull();
  });
});

it("bundles the pinned model and matching MediaPipe WASM files", () => {
  const publicDir = resolve(process.cwd(), "apps/web/public/proctoring");
  const model = readFileSync(resolve(publicDir, "blaze_face_short_range.float16.v1.tflite"));
  expect(createHash("sha256").update(model).digest("hex")).toBe(
    "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f",
  );

  const packageWasm = resolve(process.cwd(), "apps/web/node_modules/@mediapipe/tasks-vision/wasm");
  for (const name of [
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_nosimd_internal.js",
    "vision_wasm_nosimd_internal.wasm",
  ]) {
    const bundledHash = createHash("sha256")
      .update(readFileSync(resolve(publicDir, "wasm", name)))
      .digest("hex");
    const packageHash = createHash("sha256")
      .update(readFileSync(resolve(packageWasm, name)))
      .digest("hex");
    expect(bundledHash).toBe(packageHash);
  }
});

describe("browser face detector", () => {
  const close = vi.fn();
  const detectForVideo = vi.fn();
  const loadDetector = vi.fn(async () => ({ close, detectForVideo }));

  beforeEach(() => {
    vi.stubGlobal("window", {});
    detectForVideo.mockReturnValue({ detections: [1] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("initializes and closes the detector", async () => {
    const detector = await createFaceDetector(loadDetector);
    expect(loadDetector).toHaveBeenCalledTimes(1);
    detector.dispose();
    detector.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("bounds inference to one fresh frame per second and confirms a sustained finding", async () => {
    detectForVideo.mockReturnValue({ detections: [] });
    const detector = await createFaceDetector(loadDetector);
    const video = videoFrame();
    video.currentTime = 0.1;
    expect(await detector.sample(video, 0)).toEqual({
      status: "ok", faceCount: 0, finding: null, sampledAtMs: 0,
    });
    video.currentTime = 0.5;
    expect(await detector.sample(video, 500)).toEqual({
      status: "ok", faceCount: 0, finding: null, sampledAtMs: 0,
    });
    expect(detectForVideo).toHaveBeenCalledTimes(1);
    video.currentTime = 1.1;
    expect((await detector.sample(video, 1_000)).finding).toBeNull();
    video.currentTime = 2.1;
    expect((await detector.sample(video, 2_000)).finding).toBe("no_face");
    expect(detectForVideo).toHaveBeenCalledTimes(3);
    detector.dispose();
  });

  it("does not convert an unready or frozen camera frame into no-face evidence", async () => {
    detectForVideo.mockReturnValue({ detections: [] });
    const detector = await createFaceDetector(loadDetector);
    const video = videoFrame();
    video.currentTime = 0.1;
    await detector.sample(video, 0);
    expect((await detector.sample(video, 3_000)).status).toBe("unavailable");
    video.currentTime = 3.1;
    (video as { readyState: number }).readyState = 1;
    expect((await detector.sample(video, 4_000)).status).toBe("unavailable");
    expect(detectForVideo).toHaveBeenCalledTimes(1);
    detector.dispose();
  });

  it("treats model initialization and inference failures as unavailable", async () => {
    const unavailableDetector = await createFaceDetector(async () => {
      throw new Error("model missing");
    });
    expect(await unavailableDetector.sample(videoFrame(), 0)).toEqual({
      status: "unavailable", finding: null, sampledAtMs: 0,
    });

    detectForVideo.mockImplementationOnce(() => { throw new Error("wasm failure"); });
    const detector = await createFaceDetector(loadDetector);
    const video = videoFrame();
    video.currentTime = 0.1;
    expect((await detector.sample(video, 1_000)).status).toBe("unavailable");
    video.currentTime = 1.1;
    expect((await detector.sample(video, 2_000)).status).toBe("unavailable");
    expect(detectForVideo).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    detector.dispose();
  });
});
