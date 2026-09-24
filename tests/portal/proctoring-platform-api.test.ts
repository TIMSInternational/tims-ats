import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({ platformPostRaw: post, isPlatformApiEnabled: () => true }));

import {
  startCandidateProctoring,
  reportCandidateProctoringEvent,
  heartbeatCandidateProctoring,
  completeCandidateProctoring,
} from '../../apps/web/lib/platform-api/proctoring';

const route = { orgSlug: 'client-one', assignmentId: '00000000-0000-4000-8000-000000000001' };

describe('candidate .NET proctoring client', () => {
  beforeEach(() => post.mockReset());

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
    post.mockResolvedValueOnce({ accepted: 'yes', eventId: 'wrong' });
    await expect(
      reportCandidateProctoringEvent({
        ...route,
        eventId: '00000000-0000-4000-8000-000000000004',
        type: 'face_missing',
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
});
