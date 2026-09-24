import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({
  platformPostRaw: post, platformGetRaw: get, isPlatformApiEnabled: () => true,
}));

import {
  startCandidateProctoring,
  reportCandidateProctoringEvent,
  heartbeatCandidateProctoring,
  completeCandidateProctoring,
  getCandidateProctoringExplanation,
  submitCandidateProctoringExplanation,
} from '../../apps/web/lib/platform-api/proctoring';

const route = { orgSlug: 'client-one', assignmentId: '00000000-0000-4000-8000-000000000001' };

describe('candidate .NET proctoring client', () => {
  beforeEach(() => { post.mockReset(); get.mockReset(); });

  it('starts through the C# relay with separate consents and parses the server start time', async () => {
    post.mockResolvedValue({
      sessionId: '00000000-0000-4000-8000-000000000002',
      status: 'active',
      startedAt: '2026-09-24T10:00:00.000Z',
    });
    const result = await startCandidateProctoring({
      ...route,
      assessmentConsentAccepted: true,
      proctoringConsentAccepted: true,
      capabilities: { camera: true, screen: true },
    });
    expect(post).toHaveBeenCalledWith(
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/start',
      {
        assessmentConsentAccepted: true,
        proctoringConsentAccepted: true,
        capabilities: { camera: true, screen: true },
      },
      route,
    );
    expect(result.startedAt).toEqual(new Date('2026-09-24T10:00:00.000Z'));
  });

  it('validates event type and server acknowledgement', async () => {
    post.mockResolvedValue({ accepted: true, eventId: '00000000-0000-4000-8000-000000000003' });
    await expect(
      reportCandidateProctoringEvent({
        ...route,
        eventId: '00000000-0000-4000-8000-000000000003',
        type: 'camera_stopped',
        clientTimestamp: '2026-09-24T10:01:00.000Z',
      }),
    ).resolves.toEqual({ accepted: true, eventId: '00000000-0000-4000-8000-000000000003' });
    expect(post).toHaveBeenCalledWith(
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/events',
      {
        eventId: '00000000-0000-4000-8000-000000000003',
        type: 'camera_stopped',
        clientTimestamp: '2026-09-24T10:01:00.000Z',
      },
      route,
    );
    post.mockResolvedValueOnce({ accepted: true, eventId: '00000000-0000-4000-8000-000000000006' });
    await expect(reportCandidateProctoringEvent({
      ...route,
      eventId: '00000000-0000-4000-8000-000000000006',
      type: 'media_capture_stopped',
    })).resolves.toMatchObject({ accepted: true });
    post.mockResolvedValueOnce({ accepted: 'yes', eventId: 'wrong' });
    await expect(
      reportCandidateProctoringEvent({
        ...route,
        eventId: '00000000-0000-4000-8000-000000000004',
        type: 'tab_hidden',
      }),
    ).rejects.toThrow();
    await expect(
      reportCandidateProctoringEvent({
        ...route,
        eventId: '00000000-0000-4000-8000-000000000005',
        type: 'face_missing' as 'tab_hidden',
      }),
    ).rejects.toThrow();
  });

  it('uses distinct heartbeat and idempotent completion routes', async () => {
    post.mockResolvedValueOnce({ serverTime: '2026-09-24T10:01:00.000Z', active: true });
    await heartbeatCandidateProctoring(route);
    post.mockResolvedValueOnce({
      sessionId: '00000000-0000-4000-8000-000000000002',
      status: 'completed',
      endedAt: '2026-09-24T10:02:00.000Z',
    });
    await completeCandidateProctoring(route);
    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/heartbeat',
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/complete',
    ]);
  });

  it('reads the server-defined statement window and sends a bounded statement to .NET', async () => {
    get.mockResolvedValue({ explanation: null, canSubmit: true, closesAt: '2026-10-01T10:00:00Z' });
    await expect(getCandidateProctoringExplanation(route)).resolves.toMatchObject({ canSubmit: true });
    expect(get).toHaveBeenCalledWith(
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/explanation', undefined, route,
    );
    post.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000007', text: 'Camera disconnected.',
      submittedAt: '2026-09-24T10:00:00Z', expiresAt: '2026-10-01T10:00:00Z',
    });
    await submitCandidateProctoringExplanation({
      ...route, submissionId: '00000000-0000-4000-8000-000000000008', text: ' Camera disconnected. ',
    });
    expect(post).toHaveBeenCalledWith(
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/explanation',
      { submissionId: '00000000-0000-4000-8000-000000000008', text: 'Camera disconnected.' }, route,
    );
    await expect(submitCandidateProctoringExplanation({
      ...route, submissionId: '00000000-0000-4000-8000-000000000008', text: '   ',
    })).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
