import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { StrictMode } from 'react';
import en from '../../apps/web/lib/i18n/en.json';
import { createFaceDetector } from '../../apps/web/lib/proctoring/face-detector';

const reportMutate = vi.fn().mockResolvedValue({ accepted: true });
const heartbeatMutate = vi.fn().mockResolvedValue({ active: true });
const stopCapture = vi.hoisted(() => vi.fn());

vi.mock('../../apps/web/lib/platform-api/proctoring', () => ({
  useReportCandidateProctoringEvent: () => ({ mutateAsync: reportMutate }),
  useHeartbeatCandidateProctoring: () => ({ mutateAsync: heartbeatMutate }),
  createCandidateProctoringMediaIntent: vi.fn(),
  postCandidateProctoringMedia: vi.fn(),
  confirmCandidateProctoringMedia: vi.fn(),
  stopCandidateProctoringMedia: stopCapture,
}));
vi.mock('../../apps/web/lib/proctoring/face-detector', () => ({ createFaceDetector: vi.fn() }));

import { ProctoringMonitor } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/proctoring-monitor';

function media(displaySurface?: string) {
  const track = Object.assign(new EventTarget(), {
    readyState: 'live' as 'live' | 'ended',
    stop: vi.fn(),
    getSettings: () => ({ displaySurface }),
  });
  return {
    stream: { getVideoTracks: () => [track], getTracks: () => [track] },
    track,
  };
}

describe('ProctoringMonitor', () => {
  beforeEach(() => {
    localStorage.setItem('tims-locale', 'EN');
    reportMutate.mockClear();
    heartbeatMutate.mockClear();
    stopCapture.mockReset().mockResolvedValue({ stopped: true });
    let uuid = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` });
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
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    vi.mocked(createFaceDetector)
      .mockReset()
      .mockResolvedValue({
        sample: vi.fn().mockResolvedValue({ status: 'ok', faceCount: 1, finding: null, sampledAtMs: 1 }),
        dispose: vi.fn(),
      });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not reload the model on rerender and reports camera interruption once', async () => {
    const camera = media();
    const screenShare = media('monitor');
    const props = {
      orgSlug: 'test-org',
      assignmentId: '00000000-0000-4000-8000-000000000001',
      initialMedia: {
        camera: camera.stream as unknown as MediaStream,
        screen: screenShare.stream as unknown as MediaStream,
      },
      onMediaChange: vi.fn(),
    };
    const view = render(
      <I18nProvider>
        <ProctoringMonitor {...props} />
      </I18nProvider>,
    );
    await waitFor(() => expect(heartbeatMutate).toHaveBeenCalledTimes(1));
    expect(createFaceDetector).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.positioningHintsOption));
    await waitFor(() => expect(createFaceDetector).toHaveBeenCalledTimes(1));
    view.rerender(
      <I18nProvider>
        <ProctoringMonitor {...props} />
      </I18nProvider>,
    );
    expect(createFaceDetector).toHaveBeenCalledTimes(1);
    camera.track.readyState = 'ended';
    act(() => {
      camera.track.dispatchEvent(new Event('ended'));
    });
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.cameraLost)).toBeInTheDocument());
    await waitFor(() => expect(reportMutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'camera_stopped' })));
    expect(reportMutate.mock.calls.filter(([event]) => event.type === 'camera_stopped')).toHaveLength(1);
    view.unmount();
    await waitFor(() => expect(screenShare.track.stop).toHaveBeenCalledTimes(1));
  });

  it('keeps permissioned media alive through the React Strict Mode effect replay', async () => {
    const camera = media();
    const screenShare = media('monitor');
    const view = render(
      <StrictMode>
        <I18nProvider>
          <ProctoringMonitor
            orgSlug="test-org"
            assignmentId="00000000-0000-4000-8000-000000000001"
            initialMedia={{
              camera: camera.stream as unknown as MediaStream,
              screen: screenShare.stream as unknown as MediaStream,
            }}
            onMediaChange={vi.fn()}
          />
        </I18nProvider>
      </StrictMode>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(camera.track.stop).not.toHaveBeenCalled();
    expect(screenShare.track.stop).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(camera.track.stop).toHaveBeenCalledTimes(1));
  });

  it('keeps a local positioning model failure off the server', async () => {
    vi.mocked(createFaceDetector).mockRejectedValue(new Error('WASM unavailable'));
    const camera = media();
    const screenShare = media('monitor');
    const props = {
      orgSlug: 'test-org',
      assignmentId: '00000000-0000-4000-8000-000000000001',
      initialMedia: {
        camera: camera.stream as unknown as MediaStream,
        screen: screenShare.stream as unknown as MediaStream,
      },
      initialPositioningHintsEnabled: true,
      onMediaChange: vi.fn(),
    };
    const view = render(
      <I18nProvider>
        <ProctoringMonitor {...props} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.faceUnavailable)).toBeInTheDocument());
    view.rerender(
      <I18nProvider>
        <ProctoringMonitor {...props} />
      </I18nProvider>,
    );
    expect(reportMutate).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps face-count positioning hints local even when the detector reports a finding', async () => {
    const dispose = vi.fn();
    vi.mocked(createFaceDetector).mockResolvedValue({
      sample: vi.fn().mockResolvedValue({ status: 'ok', faceCount: 0, finding: 'no_face', sampledAtMs: 1 }),
      dispose,
    });
    const camera = media();
    const screenShare = media('monitor');
    const view = render(
      <I18nProvider>
        <ProctoringMonitor
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          initialMedia={{ camera: camera.stream as unknown as MediaStream, screen: screenShare.stream as unknown as MediaStream }}
          initialPositioningHintsEnabled
          onMediaChange={vi.fn()}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.faceMissing)).toBeInTheDocument(), { timeout: 3_000 });
    expect(reportMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(en.proctoring.candidate.positioningHintsOption));
    expect(screen.queryByText(en.proctoring.candidate.faceMissing)).not.toBeInTheDocument();
    expect(dispose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('records an explicit event when the candidate intentionally stops image capture', async () => {
    const camera = media();
    const screenShare = media('monitor');
    const view = render(
      <I18nProvider>
        <ProctoringMonitor
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          initialMedia={{ camera: camera.stream as unknown as MediaStream, screen: screenShare.stream as unknown as MediaStream }}
          mediaEvidenceConsented
          onMediaChange={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.mediaEvidenceStop }));
    await waitFor(() => expect(reportMutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'media_capture_stopped' })));
    expect(screen.getByText(en.proctoring.candidate.mediaEvidenceStopped)).toBeInTheDocument();
    expect(reportMutate.mock.calls.filter(([event]) => event.type === 'media_capture_stopped')).toHaveLength(1);
    expect(stopCapture).toHaveBeenCalledWith({
      orgSlug: 'test-org', assignmentId: '00000000-0000-4000-8000-000000000001',
    });
    view.unmount();
  });

  it('keeps capture stopped and offers a retry if the server stop fails', async () => {
    stopCapture.mockRejectedValueOnce(new Error('offline'));
    const camera = media();
    const screenShare = media('monitor');
    const view = render(
      <I18nProvider>
        <ProctoringMonitor
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          initialMedia={{ camera: camera.stream as unknown as MediaStream, screen: screenShare.stream as unknown as MediaStream }}
          mediaEvidenceConsented
          onMediaChange={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.mediaEvidenceStop }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.mediaEvidenceStopSyncError)).toBeInTheDocument());
    expect(screen.getByText(en.proctoring.candidate.mediaEvidenceStopped)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.mediaEvidenceRetryStop }));
    await waitFor(() => expect(stopCapture).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(en.proctoring.candidate.mediaEvidenceStopSyncError)).not.toBeInTheDocument());
    view.unmount();
  });

  it('drains queued signals behind an in-flight event before completing submit flush', async () => {
    let acknowledge: (() => void) | undefined;
    reportMutate.mockImplementationOnce(() => new Promise((resolve) => {
      acknowledge = () => resolve({ accepted: true });
    }));
    const camera = media();
    const screenShare = media('monitor');
    let flush!: () => Promise<void>;
    const view = render(
      <I18nProvider>
        <ProctoringMonitor
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          initialMedia={{ camera: camera.stream as unknown as MediaStream, screen: screenShare.stream as unknown as MediaStream }}
          onMediaChange={vi.fn()}
          onRegisterFlush={(current) => { if (current) flush = current; }}
        />
      </I18nProvider>,
    );
    act(() => camera.track.dispatchEvent(new Event('ended')));
    await waitFor(() => expect(reportMutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'camera_stopped' })));
    act(() => screenShare.track.dispatchEvent(new Event('ended')));
    expect(flush).toBeTypeOf('function');
    let settled = false;
    const pending = flush().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await act(async () => acknowledge?.());
    await pending;
    expect(settled).toBe(true);
    expect(reportMutate).toHaveBeenCalledTimes(2);
    expect(reportMutate).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'screen_share_stopped' }));
    view.unmount();
  });
});
