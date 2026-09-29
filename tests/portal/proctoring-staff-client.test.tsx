import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { platformGetRaw, platformPostRaw } = vi.hoisted(() => ({
  platformGetRaw: vi.fn(),
  platformPostRaw: vi.fn(),
}));
vi.mock('../../apps/web/lib/platform-api/client', () => ({
  platformGetRaw, platformPostRaw, isPlatformApiEnabled: () => true,
}));

import { useProctoringCapability } from '../../apps/web/lib/platform-api/proctoring';

import {
  useProctoringEvidence,
  useProctoringReviewQueue,
  useReviewProctoring,
  useGrantProctoringAccommodation,
  useProctoringMedia,
  useProctoringMediaReadGrant,
} from '../../apps/web/lib/platform-api/proctoring-staff';

const assignmentId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const candidateId = '33333333-3333-4333-8333-333333333333';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('C# proctoring response boundary', () => {
  afterEach(() => {
    platformGetRaw.mockReset();
    platformPostRaw.mockReset();
    vi.unstubAllEnvs();
  });

  it('uses the live C# feature flag before showing capture or review UI', async () => {
    platformGetRaw.mockResolvedValue({ enabled: false });
    const { result } = renderHook(() => useProctoringCapability(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.enabled).toBe(false);
    expect(platformGetRaw).toHaveBeenCalledWith('/proctoring/capabilities');
  });

  it('accepts a bounded completed-session queue from the platform API', async () => {
    platformGetRaw.mockResolvedValue({ items: [{
      sessionId, assignmentId,
      candidate: { id: candidateId, firstName: 'Ada', lastName: 'Lovelace' },
      assessmentType: { name: 'Reasoning' },
      endedAt: '2026-09-24T12:00:00Z', flagCount: 2,
      severity: 'medium', reviewStatus: 'unreviewed', status: 'completed',
    }], nextCursor: null });
    const { result } = renderHook(() => useProctoringReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].items[0].candidate.firstName).toBe('Ada');
    expect(platformGetRaw).toHaveBeenCalledWith('/proctoring/reviews', { limit: 25, cursor: undefined });
  });

  it('rejects a forged misconduct verdict in place of advisory evidence', async () => {
    platformGetRaw.mockResolvedValue({
      sessionId, assignmentId, startedAt: '2026-09-24T11:00:00Z',
      endedAt: '2026-09-24T12:00:00Z', lastHeartbeatAt: null,
      flagCount: 1, severity: 'medium', status: 'completed', events: [],
      nextCursor: null,
      review: { status: 'unreviewed', notes: null, reviewedAt: null },
      evidenceLevel: 'verified_cheating',
    });
    const { result } = renderHook(() => useProctoringEvidence(assignmentId), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('sends a human review decision to the C# API', async () => {
    platformPostRaw.mockResolvedValue({ status: 'concern', notes: 'Check context', reviewedAt: '2026-09-24T12:30:00Z' });
    const { result } = renderHook(() => useReviewProctoring(), { wrapper });
    await result.current.mutateAsync({
      assignmentId, status: 'concern', notes: 'Check context', seenExplanationId: null,
    });
    expect(platformPostRaw).toHaveBeenCalledWith(
      '/proctoring/assignments/{assignmentId}/review',
      { status: 'concern', notes: 'Check context', seenExplanationId: null },
      { assignmentId },
    );
  });

  it('sends only an enumerated accommodation reason to the C# API', async () => {
    platformPostRaw.mockResolvedValue({ assignmentId, proctoringRequired: false });
    const { result } = renderHook(() => useGrantProctoringAccommodation(), { wrapper });
    await result.current.mutateAsync({ assignmentId, reason: 'technical_unavailable' });
    expect(platformPostRaw).toHaveBeenCalledWith(
      '/proctoring/assignments/{assignmentId}/accommodation',
      { reason: 'technical_unavailable' }, { assignmentId },
    );
  });

  it('loads bounded media metadata and detector cues', async () => {
    platformGetRaw.mockResolvedValue({
      sessionId, assignmentId,
      mediaConsented: true,
      items: [{
        evidenceId: candidateId, mediaType: 'camera', captureReason: 'periodic',
        status: 'processed', createdAt: '2026-09-24T12:00:00Z',
        confirmedAt: '2026-09-24T12:00:02Z', expiresAt: '2026-10-01T12:00:02Z',
        findings: [{ detector: 'rekognition_detect_faces', modelRevision: 'v1',
          label: 'face_count', resultKind: 'signal', confidence: null,
          detectedCount: 1, failureCode: null, inferredAt: '2026-09-24T12:00:03Z' }],
      }],
    });
    const { result } = renderHook(() => useProctoringMedia(assignmentId), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0].findings[0].detectedCount).toBe(1);
    expect(platformGetRaw).toHaveBeenCalledWith(
      '/proctoring/assignments/{assignmentId}/media', undefined, { assignmentId },
    );
  });

  it('refuses a signed read URL from any unconfigured S3 origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_PROCTORING_EVIDENCE_S3_ORIGIN', 'https://bucket.s3.us-west-2.amazonaws.com');
    platformGetRaw.mockResolvedValue({
      evidenceId: candidateId, contentType: 'image/jpeg',
      url: 'https://other-bucket.s3.us-west-2.amazonaws.com/sealed/photo.jpg',
      expiresAt: new Date(Date.now() + 40_000).toISOString(),
    });
    const { result } = renderHook(() => useProctoringMediaReadGrant(), { wrapper });
    await expect(result.current.mutateAsync({ assignmentId, evidenceId: candidateId }))
      .rejects.toThrow('Invalid evidence read grant');
  });
});
