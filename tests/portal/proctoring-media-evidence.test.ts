import { afterEach, describe, expect, it, vi } from 'vitest';
import { CandidateMediaEvidenceController } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/proctoring-media-evidence';
import { PlatformApiError } from '../../apps/web/lib/platform-api/client';

const route = { orgSlug: 'test-org', assignmentId: '00000000-0000-4000-8000-000000000001' };
const evidenceId = '00000000-0000-4000-8000-000000000002';

function media() {
  const cameraTrack = { readyState: 'live', getSettings: () => ({}), stop: vi.fn() };
  const screenTrack = { readyState: 'live', getSettings: () => ({ displaySurface: 'monitor' }), stop: vi.fn() };
  return {
    camera: { getVideoTracks: () => [cameraTrack] },
    screen: { getVideoTracks: () => [screenTrack] },
  } as unknown as { camera: MediaStream; screen: MediaStream };
}

function harness() {
  const capture = vi.fn().mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  const createIntent = vi.fn().mockResolvedValue({
    evidenceId, status: 'intent', intentExpiresAt: '2099-09-24T00:00:00Z',
    uploadUrl: 'https://bucket.s3.us-west-2.amazonaws.com/', uploadFields: { key: 'staging/key' },
  });
  const post = vi.fn().mockResolvedValue(undefined);
  const confirm = vi.fn().mockResolvedValue({ evidenceId, status: 'ready', expiresAt: '2099-10-01T00:00:00Z' });
  const onState = vi.fn();
  const deps = {
    capture, createIntent, post, confirm,
    newId: vi.fn(() => '00000000-0000-4000-8000-000000000003'),
    now: () => Date.now(),
    random: () => 0,
  };
  const initialMedia = media();
  const controller = new CandidateMediaEvidenceController(route, initialMedia, onState, deps);
  return { controller, capture, createIntent, post, confirm, onState, deps, initialMedia };
}

afterEach(() => vi.useRealTimers());

describe('candidate media evidence scheduler', () => {
  it('never captures before activation and stops future captures after revocation', async () => {
    vi.useFakeTimers();
    const { controller, capture } = harness();
    controller.capturePeriodic();
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
    controller.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(capture).toHaveBeenCalledTimes(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(130_000);
    controller.captureEvent('camera');
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('captures at a low-cost cadence with at least 65 seconds between periodic stills', async () => {
    vi.useFakeTimers();
    const { controller, capture } = harness();
    controller.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(64_999);
    expect(capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(capture).toHaveBeenCalledTimes(4);
    controller.stop();
  });

  it('jitters the first and later captures while retaining a minimum 65-second gap', async () => {
    vi.useFakeTimers();
    const { controller, capture, deps } = harness();
    deps.random = () => 0.5;
    controller.start();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(69_999);
    expect(capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(capture).toHaveBeenCalledTimes(4);
    controller.stop();
  });

  it('retries a denied signed POST with the same capture ID and without a second still', async () => {
    const { controller, capture, createIntent, post, confirm } = harness();
    post.mockRejectedValueOnce(new Error('S3 denied'));
    controller.start();
    controller.captureEvent('screen');
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
    controller.retry();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(createIntent).toHaveBeenCalledTimes(2);
    expect(createIntent.mock.calls[0]?.[0].clientCaptureId)
      .toBe(createIntent.mock.calls[1]?.[0].clientCaptureId);
    controller.stop();
  });

  it('automatically retries a busy confirmation with the same capture and stops retrying on success', async () => {
    vi.useFakeTimers();
    const { controller, capture, createIntent, confirm, post } = harness();
    confirm.mockRejectedValueOnce(new PlatformApiError(429, 'Too Many Requests'));
    controller.start();
    controller.captureEvent('camera');
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(confirm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(createIntent.mock.calls[0]?.[0].clientCaptureId)
      .toBe(createIntent.mock.calls[1]?.[0].clientCaptureId);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(confirm).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('cancels a busy confirmation retry when capture is stopped', async () => {
    vi.useFakeTimers();
    const { controller, confirm } = harness();
    confirm.mockRejectedValueOnce(new PlatformApiError(429, 'Too Many Requests'));
    controller.start();
    controller.captureEvent('camera');
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    controller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('abandons an expired signed POST intent and allows a new periodic capture ID', async () => {
    const { controller, capture, createIntent, post, deps } = harness();
    let clock = Date.now();
    deps.now = () => clock;
    deps.newId.mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004');
    createIntent.mockResolvedValueOnce({
      evidenceId, status: 'intent', intentExpiresAt: new Date(clock + 1_000).toISOString(),
      uploadUrl: 'https://bucket.s3.us-west-2.amazonaws.com/', uploadFields: { key: 'staging/first' },
    });
    post.mockRejectedValueOnce(new Error('S3 temporarily denied'));
    controller.start();
    controller.captureEvent('camera');
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    clock += 2_000;
    controller.retry();
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(createIntent.mock.calls.map(([input]) => input.clientCaptureId)).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ]);
    expect(createIntent.mock.calls[1]?.[0].captureReason).toBe('periodic');
    controller.stop();
  });

  it('surfaces absent camera or entire-screen tracks during a periodic tick', async () => {
    const { controller, capture, onState, initialMedia } = harness();
    controller.updateMedia({
      camera: { getVideoTracks: () => [{ readyState: 'ended' }] } as unknown as MediaStream,
      screen: initialMedia.screen,
    });
    controller.start();
    controller.capturePeriodic();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    expect(capture.mock.calls[0]?.[1]).toBe('screen');
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ active: true, unavailable: true }));
    controller.stop();
  });

  it('never uploads after revocation while an intent request is unresolved', async () => {
    const { controller, createIntent, post } = harness();
    let finishIntent: ((result: unknown) => void) | undefined;
    createIntent.mockImplementationOnce(() => new Promise((resolve) => { finishIntent = resolve; }));
    controller.start();
    controller.captureEvent('camera');
    await vi.waitFor(() => expect(createIntent).toHaveBeenCalledTimes(1));
    controller.stop();
    finishIntent?.({
      evidenceId, status: 'intent', intentExpiresAt: '2099-09-24T00:00:00Z',
      uploadUrl: 'https://bucket.s3.us-west-2.amazonaws.com/', uploadFields: { key: 'staging/key' },
    });
    await Promise.resolve();
    expect(post).not.toHaveBeenCalled();
  });

  it('limits event captures to five per media type', async () => {
    const { controller, capture, post } = harness();
    controller.start();
    for (let index = 0; index < 7; index += 1) {
      controller.captureEvent('camera');
      await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(Math.min(index + 1, 5)));
    }
    expect(capture).toHaveBeenCalledTimes(5);
    controller.stop();
  });

  it('treats a ready intent retry as complete without a second S3 POST', async () => {
    const { controller, createIntent, post, confirm } = harness();
    post.mockRejectedValueOnce(new Error('connection lost after S3 accepted'));
    controller.start();
    controller.captureEvent('camera');
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    createIntent.mockResolvedValueOnce({
      evidenceId, status: 'ready', intentExpiresAt: '2099-09-24T00:00:00Z',
      uploadUrl: null, uploadFields: null,
    });
    controller.retry();
    await vi.waitFor(() => expect(createIntent).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    controller.stop();
  });
});
