import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureProctoringStill } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/proctoring-still';

function stream(displaySurface?: string) {
  const track = { readyState: 'live', getSettings: () => ({ displaySurface }) };
  return { getVideoTracks: () => [track] } as unknown as MediaStream;
}

describe('browser proctoring still capture', () => {
  const drawImage = vi.fn();

  beforeEach(() => {
    drawImage.mockClear();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true, get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 4000 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 3000 });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('resizes a live camera frame before encoding a bounded JPEG', async () => {
    const still = await captureProctoringStill(
      { camera: stream(), screen: stream('monitor') }, 'camera', new AbortController().signal,
    );
    expect(still.type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLVideoElement), 0, 0, 1280, 960);
  });

  it('refuses a tab/window screen stream without drawing or uploading it', async () => {
    await expect(captureProctoringStill(
      { camera: stream(), screen: stream('browser') }, 'screen', new AbortController().signal,
    )).rejects.toThrow('capture_track_unavailable');
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('refuses a camera JPEG that stays above the 2 MiB bound after compression attempts', async () => {
    const oversized = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' });
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(oversized));
    await expect(captureProctoringStill(
      { camera: stream(), screen: stream('monitor') }, 'camera', new AbortController().signal,
    )).rejects.toThrow('capture_too_large');
    expect(encode).toHaveBeenCalledTimes(9);
  });

  it('cancels capture before a pending video frame is encoded', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise(() => undefined));
    const abort = new AbortController();
    const pending = captureProctoringStill({ camera: stream(), screen: stream('monitor') }, 'camera', abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow('capture_cancelled');
    expect(drawImage).not.toHaveBeenCalled();
  });
});
