import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { ProctoringPreflight } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/proctoring-preflight';
import { createFaceDetector } from '../../apps/web/lib/proctoring/face-detector';

vi.mock('../../apps/web/lib/proctoring/face-detector', () => ({
  createFaceDetector: vi.fn(),
}));

function stream(displaySurface?: string) {
  const track = {
    readyState: 'live',
    stop: vi.fn(),
    getSettings: () => ({ displaySurface }),
    addEventListener: vi.fn(),
  };
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
    track,
  };
}

function setup(mediaEvidenceAvailable = false, mediaEvidenceUnavailableDuration = false) {
  localStorage.setItem('tims-locale', 'EN');
  const onAuthorize = vi.fn().mockResolvedValue(new Date('2026-09-24T10:00:00.000Z'));
  const onReady = vi.fn();
  const view = render(
    <I18nProvider>
      <ProctoringPreflight isResume={false} mediaEvidenceAvailable={mediaEvidenceAvailable}
        mediaEvidenceUnavailableDuration={mediaEvidenceUnavailableDuration} onAuthorize={onAuthorize} onReady={onReady} />
    </I18nProvider>,
  );
  return { onAuthorize, onReady, ...view };
}

describe('ProctoringPreflight', () => {
  beforeEach(() => {
    localStorage.clear();
    const videoStreams = new WeakMap<HTMLMediaElement, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return videoStreams.get(this) ?? null;
      },
      set(this: HTMLMediaElement, value: unknown) {
        videoStreams.set(this, value);
      },
    });
    let sampleNumber = 0;
    vi.mocked(createFaceDetector)
      .mockReset()
      .mockResolvedValue({
        sample: vi.fn().mockImplementation(async () => ({
          status: 'ok' as const,
          faceCount: 1,
          finding: null,
          sampledAtMs: ++sampleNumber,
        })),
        dispose: vi.fn(),
      });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows seven-day image retention and keeps media consent separate and off by default', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream()),
        getDisplayMedia: vi.fn().mockResolvedValue(stream('monitor')),
      },
    });
    const { onAuthorize, onReady } = setup(true);
    const mediaConsent = screen.getByLabelText(en.proctoring.candidate.mediaEvidenceConsent);
    expect(mediaConsent).not.toBeChecked();
    expect(screen.getByText(en.proctoring.candidate.privacyWithMedia)).toHaveTextContent('7 days');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.cameraConsent));
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.screenConsent));
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableCamera }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.cameraReady)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
    await waitFor(() => expect(screen.getByRole('button', { name: en.proctoring.candidate.start })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.start }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onAuthorize.mock.calls[0]?.[1]).toBe(false);
    expect(onReady.mock.calls[0]?.[3]).toBe(false);
  });

  it('explains why media sampling is unavailable for longer or untimed assessments', () => {
    setup(false, true);
    expect(screen.getByText(en.proctoring.candidate.mediaEvidenceDurationUnavailable)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.proctoring.candidate.mediaEvidenceConsent)).not.toBeInTheDocument();
  });

  it('does not start the server timer until separate consents and both devices are ready', async () => {
    const camera = stream();
    const screenStream = stream('monitor');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(camera),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
      },
    });
    const { onAuthorize, onReady, unmount } = setup();
    const start = screen.getByRole('button', { name: en.proctoring.candidate.start });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.cameraConsent));
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.screenConsent));
    expect(start).toBeDisabled();
    expect(onAuthorize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableCamera }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.cameraReady)).toBeInTheDocument());
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5_000 });
    expect(createFaceDetector).not.toHaveBeenCalled();
    fireEvent.click(start);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onAuthorize).toHaveBeenCalledTimes(1);
    expect(onAuthorize.mock.calls[0][0]).toEqual({ camera, screen: screenStream });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
    unmount();
    expect(camera.track.stop).not.toHaveBeenCalled();
    expect(screenStream.track.stop).not.toHaveBeenCalled();
  });

  it('does not use a local face-count hint as an entry condition', async () => {
    vi.mocked(createFaceDetector).mockResolvedValue({
      sample: vi.fn().mockResolvedValue({ status: 'ok', faceCount: 0, finding: 'no_face', sampledAtMs: 1 }),
      dispose: vi.fn(),
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream()),
        getDisplayMedia: vi.fn().mockResolvedValue(stream('monitor')),
      },
    });
    const { onAuthorize } = setup();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.cameraConsent));
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.screenConsent));
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableCamera }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.cameraReady)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.positioningHintsOption));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.faceMissing)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
    const start = screen.getByRole('button', { name: en.proctoring.candidate.start });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(onAuthorize).toHaveBeenCalledTimes(1));
  });

  it('rejects tab/window sharing and releases the rejected media', async () => {
    const camera = stream();
    const tab = stream('browser');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(camera),
        getDisplayMedia: vi.fn().mockResolvedValue(tab),
      },
    });
    const { onAuthorize, unmount } = setup();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.cameraConsent));
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.screenConsent));
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableCamera }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.cameraReady)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(en.proctoring.candidate.screenSurfaceError),
    );
    expect(tab.track.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: en.proctoring.candidate.start })).toBeDisabled();
    expect(onAuthorize).not.toHaveBeenCalled();
    unmount();
    expect(camera.track.stop).toHaveBeenCalledTimes(1);
  });

  it('allows the assessment to start when optional local positioning hints are unavailable', async () => {
    vi.mocked(createFaceDetector).mockRejectedValue(new Error('model unavailable'));
    const camera = stream();
    const screenStream = stream('monitor');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(camera),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
      },
    });
    const { onAuthorize } = setup();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.cameraConsent));
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.screenConsent));
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableCamera }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.cameraReady)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.positioningHintsOption));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.preflightFaceUnavailable)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.screenReady)).toBeInTheDocument());
    const start = screen.getByRole('button', { name: en.proctoring.candidate.start });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    await waitFor(() => expect(onAuthorize).toHaveBeenCalledTimes(1));
  });

  it('stops screen capture when consent is withdrawn before start', async () => {
    const screenStream = stream('monitor');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
      },
    });
    setup();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    const screenConsent = screen.getByLabelText(en.proctoring.candidate.screenConsent);
    fireEvent.click(screenConsent);
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.screenReady)).toBeInTheDocument());
    fireEvent.click(screenConsent);
    expect(screenStream.track.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en.proctoring.candidate.screenNotReady)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.proctoring.candidate.start })).toBeDisabled();
  });

  it('shows a non-blocking hint when the local positioning model stalls', async () => {
    vi.useFakeTimers();
    vi.mocked(createFaceDetector).mockImplementation(
      () => new Promise<Awaited<ReturnType<typeof createFaceDetector>>>(() => undefined),
    );
    const camera = stream();
    const screenStream = stream('monitor');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(camera), getDisplayMedia: vi.fn().mockResolvedValue(screenStream) },
    });
    const { onAuthorize } = setup();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.cameraConsent));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableCamera }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.positioningHintsOption));
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.screenConsent));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(en.proctoring.candidate.screenReady)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.proctoring.candidate.start })).toBeEnabled();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText(en.proctoring.candidate.preflightFaceUnavailable)).toBeInTheDocument();
    const start = screen.getByRole('button', { name: en.proctoring.candidate.start });
    expect(start).toBeEnabled();
    await act(async () => {
      fireEvent.click(start);
      await Promise.resolve();
    });
    expect(onAuthorize).toHaveBeenCalledTimes(1);
  });
});
