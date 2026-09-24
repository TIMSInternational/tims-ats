'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { platformGetRaw, platformPostRaw } from './client';

const reviewStatus = z.enum(['unreviewed', 'clear', 'concern', 'inconclusive']);
const decisionStatus = z.enum(['clear', 'concern', 'inconclusive']);
const accommodationReason = z.enum(['technical_unavailable', 'accessibility', 'other']);
const eventType = z.enum([
  'tab_hidden', 'focus_lost', 'camera_stopped', 'screen_share_stopped',
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

export type ProctoringEvidencePage = z.infer<typeof evidencePage>;
export type ProctoringReviewQueuePage = z.infer<typeof reviewQueuePage>;
export type ProctoringDecision = z.infer<typeof decisionStatus>;
export type ProctoringAccommodationReason = z.infer<typeof accommodationReason>;

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
    mutationFn: async (input: { assignmentId: string; status: ProctoringDecision; notes?: string }) =>
      z.object({ status: decisionStatus, notes: z.string().nullable(), reviewedAt: z.string().datetime() }).parse(
        await platformPostRaw('/proctoring/assignments/{assignmentId}/review',
          { status: input.status, notes: input.notes }, { assignmentId: input.assignmentId }),
      ),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: ['platform-api', 'proctoring', 'events', input.assignmentId] });
      void queryClient.invalidateQueries({ queryKey: ['platform-api', 'proctoring', 'reviews'] });
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
