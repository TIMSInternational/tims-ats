'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PlatformApiError, platformGetRaw, platformPostRaw } from './client';

const reviewStatus = z.enum(['unreviewed', 'clear', 'concern', 'inconclusive']);
const decisionStatus = z.enum(['clear', 'concern', 'inconclusive']);
const accommodationReason = z.enum(['technical_unavailable', 'accessibility', 'other']);
const eventType = z.enum([
  'tab_hidden', 'focus_lost', 'camera_stopped', 'screen_share_stopped',
  'media_capture_stopped',
  'face_missing', 'multiple_faces', 'model_unavailable', 'heartbeat_gap',
]);

const reviewQueuePage = z.object({
  items: z.array(z.object({
    sessionId: z.string().uuid(),
    assignmentId: z.string().uuid(),
    candidate: z.object({ id: z.string().uuid(), firstName: z.string(), lastName: z.string() }),
    assessmentType: z.object({ name: z.string() }),
    endedAt: z.string().datetime().nullable(),
    flagCount: z.number().int().nonnegative(),
    severity: z.string().nullable(),
    reviewStatus,
    status: z.enum(['completed', 'needs_attention']),
  })).max(50),
  nextCursor: z.string().uuid().nullable(),
});

const evidencePage = z.object({
  sessionId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  flagCount: z.number().int().nonnegative(),
  severity: z.string().nullable(),
  status: z.enum(['active', 'completed']),
  events: z.array(z.object({
    id: z.string().uuid(),
    type: eventType,
    severity: z.enum(['low', 'medium']),
    occurredAt: z.string().datetime(),
    source: z.enum(['client_observation', 'server_inferred']),
    clientAt: z.string().datetime().nullable(),
  })).max(200),
  nextCursor: z.string().uuid().nullable(),
  review: z.object({
    status: reviewStatus,
    notes: z.string().nullable(),
    reviewedAt: z.string().datetime().nullable(),
  }),
  evidenceLevel: z.literal('unverified_client_signals'),
});

const mediaResponse = z.object({
  sessionId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  mediaConsented: z.boolean(),
  items: z.array(z.object({
    evidenceId: z.string().uuid(),
    mediaType: z.enum(['camera', 'screen']),
    captureReason: z.enum(['periodic', 'event']),
    status: z.enum(['intent', 'confirming', 'ready', 'processing', 'processed', 'unavailable', 'rejected', 'expired']),
    createdAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    findings: z.array(z.object({
      detector: z.string().max(64),
      modelRevision: z.string().max(128),
      label: z.string().max(64),
      resultKind: z.enum(['signal', 'unavailable']),
      confidence: z.number().min(0).max(1).nullable(),
      detectedCount: z.number().int().min(0).max(100).nullable(),
      failureCode: z.string().max(64).nullable(),
      inferredAt: z.string().datetime(),
    })).max(20),
  })).max(70),
});

const mediaReadGrant = z.object({
  evidenceId: z.string().uuid(),
  contentType: z.enum(['image/jpeg', 'image/webp']),
  url: z.string().url(),
  expiresAt: z.string().datetime(),
});

const candidateExplanation = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(2000),
  submittedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type ProctoringEvidencePage = z.infer<typeof evidencePage>;
export type ProctoringReviewQueuePage = z.infer<typeof reviewQueuePage>;
export type ProctoringDecision = z.infer<typeof decisionStatus>;
export type ProctoringAccommodationReason = z.infer<typeof accommodationReason>;
export type ProctoringMediaItem = z.infer<typeof mediaResponse>['items'][number];
export type StaffCandidateExplanation = z.infer<typeof candidateExplanation>;

export function useProctoringReviewQueue(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['platform-api', 'proctoring', 'reviews'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => reviewQueuePage.parse(await platformGetRaw(
      '/proctoring/reviews', { limit: 25, cursor: pageParam },
    )),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: false,
  });
}

export function useProctoringEvidence(assignmentId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['platform-api', 'proctoring', 'events', assignmentId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => evidencePage.parse(await platformGetRaw(
      '/proctoring/assignments/{assignmentId}/events',
      { limit: 100, cursor: pageParam }, { assignmentId },
    )),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: false,
  });
}

export function useStaffCandidateExplanation(assignmentId: string, enabled = true) {
  return useQuery({
    queryKey: ['platform-api', 'proctoring', 'explanation', assignmentId],
    queryFn: async () => candidateExplanation.nullable().parse(await platformGetRaw(
      '/proctoring/assignments/{assignmentId}/explanation', undefined, { assignmentId },
    )),
    enabled,
    retry: false,
  });
}

export function useProctoringMedia(assignmentId: string, enabled = true) {
  return useQuery({
    queryKey: ['platform-api', 'proctoring', 'media', assignmentId],
    queryFn: async () => mediaResponse.parse(await platformGetRaw(
      '/proctoring/assignments/{assignmentId}/media', undefined, { assignmentId },
    )),
    enabled,
    retry: false,
  });
}

export function useProctoringMediaReadGrant() {
  return useMutation({
    mutationFn: async (input: { assignmentId: string; evidenceId: string }) => {
      const grant = mediaReadGrant.parse(await platformGetRaw(
        '/proctoring/assignments/{assignmentId}/media/{evidenceId}/view',
        undefined, input,
      ));
      const expectedOrigin = process.env.NEXT_PUBLIC_PROCTORING_EVIDENCE_S3_ORIGIN;
      const signed = new URL(grant.url);
      if (!expectedOrigin || signed.protocol !== 'https:'
        || signed.origin !== expectedOrigin || signed.username || signed.password
        || Date.parse(grant.expiresAt) <= Date.now()) {
        throw new Error('Invalid evidence read grant');
      }
      return grant;
    },
  });
}

export function useSetProctoringPolicy(onSuccess?: () => void) {
  return useMutation({
    mutationFn: async (input: { assessmentTypeId: string; enabled: boolean }) =>
      z.object({ assessmentTypeId: z.string().uuid(), proctoringEnabled: z.boolean() }).parse(
        await platformPostRaw('/proctoring/types/{typeId}/policy', { enabled: input.enabled },
          { typeId: input.assessmentTypeId }),
      ),
    onSuccess,
  });
}

export function useReviewProctoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      assignmentId: string; status: ProctoringDecision; notes?: string;
      seenExplanationId: string | null;
    }) =>
      z.object({ status: decisionStatus, notes: z.string().nullable(), reviewedAt: z.string().datetime() }).parse(
        await platformPostRaw('/proctoring/assignments/{assignmentId}/review',
          { status: input.status, notes: input.notes, seenExplanationId: input.seenExplanationId },
          { assignmentId: input.assignmentId }),
      ),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: ['platform-api', 'proctoring', 'events', input.assignmentId] });
      void queryClient.invalidateQueries({ queryKey: ['platform-api', 'proctoring', 'reviews'] });
    },
    onError: (error, input) => {
      if (error instanceof PlatformApiError && error.status === 409) {
        void queryClient.invalidateQueries({
          queryKey: ['platform-api', 'proctoring', 'explanation', input.assignmentId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['platform-api', 'proctoring', 'events', input.assignmentId],
        });
      }
    },
  });
}

export function useGrantProctoringAccommodation() {
  return useMutation({
    mutationFn: async (input: { assignmentId: string; reason: ProctoringAccommodationReason }) =>
      z.object({ assignmentId: z.string().uuid(), proctoringRequired: z.literal(false) }).parse(
        await platformPostRaw('/proctoring/assignments/{assignmentId}/accommodation',
          { reason: accommodationReason.parse(input.reason) }, { assignmentId: input.assignmentId }),
      ),
  });
}
