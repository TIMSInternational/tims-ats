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

function setup() {
  localStorage.setItem('tims-locale', 'EN');
  const onAuthorize = vi.fn().mockResolvedValue(new Date('2026-09-24T10:00:00.000Z'));
  const onReady = vi.fn();
  const view = render(
    <I18nProvider>
      <ProctoringPreflight isResume={false} onAuthorize={onAuthorize} onReady={onReady} />
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

  it('does not start when local face analysis is unavailable', async () => {
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
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.preflightFaceUnavailable)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableScreen }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.screenReady)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: en.proctoring.candidate.start })).toBeDisabled();
    expect(onAuthorize).not.toHaveBeenCalled();
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

  it('shows a recoverable failure when the face model stalls instead of checking forever', async () => {
    vi.useFakeTimers();
    vi.mocked(createFaceDetector).mockImplementation(
      () => new Promise<Awaited<ReturnType<typeof createFaceDetector>>>(() => undefined),
    );
    const camera = stream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(camera), getDisplayMedia: vi.fn() },
    });
    setup();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.cameraConsent));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.enableCamera }));
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText(en.proctoring.candidate.preflightFaceUnavailable)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.proctoring.candidate.start })).toBeDisabled();
  });
});
