'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { isPlatformApiEnabled, platformGetRaw, platformPostRaw } from './client';

const capabilityResponse = z.object({ enabled: z.boolean() });

export function useProctoringCapability() {
  return useQuery({
    queryKey: ['platform-api', 'proctoring', 'capability'],
    queryFn: async () => capabilityResponse.parse(await platformGetRaw('/proctoring/capabilities')),
    enabled: isPlatformApiEnabled(),
    retry: false,
    staleTime: 60_000,
  });
}

const routeInput = z.object({
  orgSlug: z.string().min(1).max(100),
  assignmentId: z.string().uuid(),
});

const dateTime = z.string().datetime({ offset: true });
const signalType = z.enum([
  'tab_hidden',
  'focus_lost',
  'camera_stopped',
  'screen_share_stopped',
  'face_missing',
  'multiple_faces',
  'model_unavailable',
]);

const startInput = routeInput.extend({
  assessmentConsentAccepted: z.literal(true),
  proctoringConsentAccepted: z.literal(true),
  capabilities: z.object({ camera: z.literal(true), screen: z.literal(true) }),
});
const eventInput = routeInput.extend({
  eventId: z.string().uuid(),
  type: signalType,
  clientTimestamp: dateTime.optional(),
});
const sessionResponse = z.object({
  sessionId: z.string().uuid(),
  status: z.literal('active'),
  startedAt: dateTime,
});
const eventResponse = z.object({ accepted: z.boolean(), eventId: z.string().uuid() });
const heartbeatResponse = z.object({ serverTime: dateTime, active: z.literal(true) });
const completionResponse = z.object({
  sessionId: z.string().uuid(),
  status: z.literal('completed'),
  endedAt: dateTime,
});

export type CandidateProctoringSignal = z.infer<typeof signalType>;
export type CandidateProctoringEventInput = z.infer<typeof eventInput>;

const path = '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring';

export async function startCandidateProctoring(input: z.infer<typeof startInput>) {
  const parsed = startInput.parse(input);
  const response = await platformPostRaw(
    `${path}/start`,
    {
      assessmentConsentAccepted: parsed.assessmentConsentAccepted,
      proctoringConsentAccepted: parsed.proctoringConsentAccepted,
      capabilities: parsed.capabilities,
    },
    { orgSlug: parsed.orgSlug, assignmentId: parsed.assignmentId },
  );
  const result = sessionResponse.parse(response);
  return { ...result, startedAt: new Date(result.startedAt) };
}

export async function reportCandidateProctoringEvent(input: CandidateProctoringEventInput) {
  const parsed = eventInput.parse(input);
  const response = await platformPostRaw(
    `${path}/events`,
    {
      eventId: parsed.eventId,
      type: parsed.type,
      clientTimestamp: parsed.clientTimestamp,
    },
    { orgSlug: parsed.orgSlug, assignmentId: parsed.assignmentId },
  );
  return eventResponse.parse(response);
}

export async function heartbeatCandidateProctoring(input: z.infer<typeof routeInput>) {
  const parsed = routeInput.parse(input);
  const response = await platformPostRaw(
    `${path}/heartbeat`,
    {},
    { orgSlug: parsed.orgSlug, assignmentId: parsed.assignmentId },
  );
  return heartbeatResponse.parse(response);
}

export async function completeCandidateProctoring(input: z.infer<typeof routeInput>) {
  const parsed = routeInput.parse(input);
  const response = await platformPostRaw(
    `${path}/complete`,
    {},
    { orgSlug: parsed.orgSlug, assignmentId: parsed.assignmentId },
  );
  return completionResponse.parse(response);
}

export function useStartCandidateProctoring() {
  return useMutation({ mutationFn: startCandidateProctoring });
}

export function useReportCandidateProctoringEvent() {
  return useMutation({ mutationFn: reportCandidateProctoringEvent });
}

export function useHeartbeatCandidateProctoring() {
  return useMutation({ mutationFn: heartbeatCandidateProctoring });
}
