import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import en from '../../apps/web/lib/i18n/en.json';

const { startMutate, complete, availability, capabilityRefetch, monitorFlush } = vi.hoisted(() => ({
  startMutate: vi.fn(),
  complete: vi.fn(),
  availability: { enabled: true, loading: false, error: false },
  capabilityRefetch: vi.fn(),
  monitorFlush: vi.fn(),
}));
const invalidate = vi.fn().mockResolvedValue(undefined);
const cameraStop = vi.fn();
const screenStop = vi.fn();
const camera = { getTracks: () => [{ stop: cameraStop }] } as unknown as MediaStream;
const screenShare = { getTracks: () => [{ stop: screenStop }] } as unknown as MediaStream;

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ candidatePortal: { getMyAssessments: { invalidate } } }),
  },
}));
vi.mock('../../apps/web/lib/platform-api/proctoring', () => ({
  useStartCandidateProctoring: () => ({ mutateAsync: startMutate }),
  completeCandidateProctoring: complete,
  useProctoringCapability: () => ({
    data: availability.loading || availability.error ? undefined : { enabled: availability.enabled },
    isLoading: availability.loading,
    isError: availability.error,
    refetch: capabilityRefetch,
  }),
}));
vi.mock(
  '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/proctoring-preflight',
  () => ({
    ProctoringPreflight: ({
      isResume,
      onAuthorize,
      onReady,
    }: {
      isResume: boolean;
      onAuthorize: (media: { camera: MediaStream; screen: MediaStream }) => Promise<Date>;
      onReady: (media: { camera: MediaStream; screen: MediaStream }, startedAt: Date) => void;
    }) => (
      <button
        type="button"
        onClick={async () => {
          const media = { camera, screen: screenShare };
          const startedAt = await onAuthorize(media);
          onReady(media, startedAt);
        }}
      >
        {isResume ? 'resume-preflight' : 'start-preflight'}
      </button>
    ),
  }),
);
vi.mock(
  '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/proctoring-monitor',
  () => ({
    ProctoringMonitor: ({ onRegisterFlush }: { onRegisterFlush?: (flush: (() => Promise<void>) | null) => void }) => {
      useEffect(() => {
        onRegisterFlush?.(() => monitorFlush());
        return () => onRegisterFlush?.(null);
      }, [onRegisterFlush]);
      return <div>monitor-stub</div>;
    },
  }),
);
vi.mock(
  '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-question-wizard',
  () => ({
    AssessmentQuestionWizard: ({ onSubmitted }: { onSubmitted: () => void }) => (
      <div>
        questions-loading-stub
        <button type="button" onClick={onSubmitted}>
          submit-stub
        </button>
      </div>
    ),
  }),
);

import { ProctoredAssessmentFlow } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/proctored-assessment-flow';

describe('ProctoredAssessmentFlow', () => {
  beforeEach(() => {
    localStorage.setItem('tims-locale', 'EN');
    startMutate.mockReset().mockResolvedValue({ startedAt: new Date('2026-09-24T10:00:00.000Z') });
    complete.mockReset().mockResolvedValue({ status: 'completed' });
    availability.enabled = true;
    availability.loading = false;
    availability.error = false;
    capabilityRefetch.mockReset();
    monitorFlush.mockReset().mockResolvedValue(undefined);
    invalidate.mockClear();
    cameraStop.mockClear();
    screenStop.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it('starts atomically only after preflight and keeps monitoring mounted while questions load', async () => {
    const onSubmitted = vi.fn();
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          status="assigned"
          existingStartedAt={null}
          expiresAt={null}
          durationMinutes={30}
          onSubmitted={onSubmitted}
        />
      </I18nProvider>,
    );
    expect(startMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('monitor-stub')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'start-preflight' }));
    await waitFor(() => expect(screen.getByText('monitor-stub')).toBeInTheDocument());
    expect(screen.getByText(/questions-loading-stub/)).toBeInTheDocument();
    expect(startMutate).toHaveBeenCalledWith({
      orgSlug: 'test-org',
      assignmentId: '00000000-0000-4000-8000-000000000001',
      assessmentConsentAccepted: true,
      proctoringConsentAccepted: true,
      capabilities: { camera: true, screen: true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'submit-stub' }));
    expect(cameraStop).toHaveBeenCalled();
    expect(screenStop).toHaveBeenCalled();
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith({
        orgSlug: 'test-org',
        assignmentId: '00000000-0000-4000-8000-000000000001',
      }),
    );
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  });

  it('uses the same preflight on resume so monitoring cannot be bypassed after refresh', () => {
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          status="in_progress"
          existingStartedAt={new Date('2026-09-24T10:00:00.000Z')}
          expiresAt={null}
          durationMinutes={30}
          onSubmitted={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'resume-preflight' })).toBeInTheDocument();
    expect(screen.queryByText('questions-loading-stub')).not.toBeInTheDocument();
    expect(startMutate).not.toHaveBeenCalled();
  });

  it('does not request camera access when the .NET proctoring service is not configured', () => {
    availability.enabled = false;
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          status="assigned"
          existingStartedAt={null}
          expiresAt={null}
          durationMinutes={30}
          onSubmitted={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(en.proctoring.candidate.serviceUnavailable);
    expect(screen.queryByRole('button', { name: 'start-preflight' })).not.toBeInTheDocument();
    expect(startMutate).not.toHaveBeenCalled();
  });

  it('does not render device preflight while capability is loading', () => {
    availability.loading = true;
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow orgSlug="test-org" assignmentId="00000000-0000-4000-8000-000000000001" status="assigned" existingStartedAt={null} expiresAt={null} durationMinutes={30} onSubmitted={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(en.proctoring.candidate.serviceChecking);
    expect(screen.queryByRole('button', { name: 'start-preflight' })).not.toBeInTheDocument();
  });

  it('offers a retry after the capability request fails without rendering device preflight', () => {
    availability.error = true;
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow orgSlug="test-org" assignmentId="00000000-0000-4000-8000-000000000001" status="assigned" existingStartedAt={null} expiresAt={null} durationMinutes={30} onSubmitted={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(en.proctoring.candidate.serviceError);
    expect(screen.queryByRole('button', { name: 'start-preflight' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.retryService }));
    expect(capabilityRefetch).toHaveBeenCalledTimes(1);
  });

  it('waits for in-flight signals before completing the .NET session', async () => {
    let finishFlush: (() => void) | undefined;
    monitorFlush.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFlush = resolve; }));
    const onSubmitted = vi.fn();
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow orgSlug="test-org" assignmentId="00000000-0000-4000-8000-000000000001" status="assigned" existingStartedAt={null} expiresAt={null} durationMinutes={30} onSubmitted={onSubmitted} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'start-preflight' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'submit-stub' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'submit-stub' }));
    expect(monitorFlush).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    await act(async () => finishFlush?.());
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('does not hold submitted answers indefinitely when event delivery stalls', async () => {
    monitorFlush.mockImplementationOnce(() => new Promise<void>(() => undefined));
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow orgSlug="test-org" assignmentId="00000000-0000-4000-8000-000000000001" status="assigned" existingStartedAt={null} expiresAt={null} durationMinutes={30} onSubmitted={vi.fn()} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'start-preflight' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'submit-stub' })).toBeInTheDocument());
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'submit-stub' }));
    expect(complete).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed C# completion retryable after answers are submitted', async () => {
    complete.mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValue({ status: 'completed' });
    const onSubmitted = vi.fn();
    render(
      <I18nProvider>
        <ProctoredAssessmentFlow
          orgSlug="test-org"
          assignmentId="00000000-0000-4000-8000-000000000001"
          status="assigned"
          existingStartedAt={null}
          expiresAt={null}
          durationMinutes={30}
          onSubmitted={onSubmitted}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'start-preflight' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'submit-stub' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'submit-stub' }));
    await waitFor(() => expect(screen.getByText(en.proctoring.candidate.finishError)).toBeInTheDocument());
    expect(onSubmitted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.retryFinish }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
