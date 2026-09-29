'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PlatformApiError, isPlatformApiEnabled, platformGetRaw, platformPostRaw } from './client';

const capabilityResponse = z.object({
  enabled: z.boolean(),
  mediaEvidenceEnabled: z.boolean().optional().default(false),
});

const EVIDENCE_S3_ORIGIN = process.env.NEXT_PUBLIC_PROCTORING_EVIDENCE_S3_ORIGIN;

export function isMediaEvidenceUploadConfigured(): boolean {
  if (!EVIDENCE_S3_ORIGIN) return false;
  try {
    const url = new URL(EVIDENCE_S3_ORIGIN);
    return url.protocol === 'https:' && url.origin === EVIDENCE_S3_ORIGIN && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

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
  'media_capture_stopped',
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
const mediaType = z.enum(['camera', 'screen']);
const captureReason = z.enum(['periodic', 'event']);
const mediaConsentResponse = z.object({ accepted: z.literal(true), consentVersion: z.string().min(1).max(80) });
const mediaIntentInput = routeInput.extend({
  clientCaptureId: z.string().uuid(),
  mediaType,
  captureReason,
  contentType: z.literal('image/jpeg'),
});
const mediaIntentResponse = z.object({
  evidenceId: z.string().uuid(),
  status: z.string().min(1).max(40),
  intentExpiresAt: dateTime,
  uploadUrl: z.string().url().max(2048).nullable(),
  uploadFields: z.record(z.string().max(100), z.string().max(4096)).nullable(),
});
const mediaConfirmResponse = z.object({
  evidenceId: z.string().uuid(),
  status: z.string().min(1).max(40),
  expiresAt: dateTime,
});
const candidateExplanation = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(2000),
  submittedAt: dateTime,
  expiresAt: dateTime,
});
const candidateExplanationState = z.object({
  explanation: candidateExplanation.nullable(),
  canSubmit: z.boolean(),
  closesAt: dateTime.nullable(),
});
const explanationInput = routeInput.extend({
  submissionId: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
});

export type CandidateProctoringSignal = z.infer<typeof signalType>;
export type CandidateProctoringEventInput = z.infer<typeof eventInput>;
export type CandidateMediaType = z.infer<typeof mediaType>;
export type CandidateCaptureReason = z.infer<typeof captureReason>;
export type CandidateMediaIntentInput = z.infer<typeof mediaIntentInput>;
export type CandidateExplanationState = z.infer<typeof candidateExplanationState>;

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

export async function getCandidateProctoringExplanation(input: z.infer<typeof routeInput>) {
  const parsed = routeInput.parse(input);
  return candidateExplanationState.parse(await platformGetRaw(
    `${path}/explanation`, undefined, parsed,
  ));
}

export async function submitCandidateProctoringExplanation(input: z.infer<typeof explanationInput>) {
  const parsed = explanationInput.parse(input);
  return candidateExplanation.parse(await platformPostRaw(
    `${path}/explanation`,
    { submissionId: parsed.submissionId, text: parsed.text },
    { orgSlug: parsed.orgSlug, assignmentId: parsed.assignmentId },
  ));
}

export function useCandidateProctoringExplanation(input: z.infer<typeof routeInput>) {
  const parsed = routeInput.parse(input);
  return useQuery({
    queryKey: ['platform-api', 'proctoring', 'explanation', parsed.orgSlug, parsed.assignmentId],
    queryFn: () => getCandidateProctoringExplanation(parsed),
    enabled: isPlatformApiEnabled(),
    retry: false,
  });
}

export function useSubmitCandidateProctoringExplanation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitCandidateProctoringExplanation,
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: ['platform-api', 'proctoring', 'explanation', input.orgSlug, input.assignmentId],
      });
    },
    onError: (error, input) => {
      if (error instanceof PlatformApiError && [409, 410].includes(error.status)) {
        void queryClient.invalidateQueries({
          queryKey: ['platform-api', 'proctoring', 'explanation', input.orgSlug, input.assignmentId],
        });
      }
    },
  });
}

export async function consentCandidateProctoringMedia(input: z.infer<typeof routeInput>) {
  const parsed = routeInput.parse(input);
  return mediaConsentResponse.parse(await platformPostRaw(
    `${path}/media-consent`, { accepted: true }, parsed,
  ));
}

export async function stopCandidateProctoringMedia(input: z.infer<typeof routeInput>) {
  const parsed = routeInput.parse(input);
  return z.object({ stopped: z.literal(true) }).parse(await platformPostRaw(
    `${path}/media-stop`, {}, parsed,
  ));
}

export async function createCandidateProctoringMediaIntent(input: CandidateMediaIntentInput) {
  const parsed = mediaIntentInput.parse(input);
  return mediaIntentResponse.parse(await platformPostRaw(
    `${path}/media-intents`,
    {
      clientCaptureId: parsed.clientCaptureId,
      mediaType: parsed.mediaType,
      captureReason: parsed.captureReason,
      contentType: parsed.contentType,
    },
    { orgSlug: parsed.orgSlug, assignmentId: parsed.assignmentId },
  ));
}

export async function confirmCandidateProctoringMedia(
  input: z.infer<typeof routeInput> & { evidenceId: string },
) {
  const parsed = routeInput.extend({ evidenceId: z.string().uuid() }).parse(input);
  return mediaConfirmResponse.parse(await platformPostRaw(
    `${path}/media-confirm`, { evidenceId: parsed.evidenceId },
    { orgSlug: parsed.orgSlug, assignmentId: parsed.assignmentId },
  ));
}

export async function postCandidateProctoringMedia(
  uploadUrl: string,
  uploadFields: Record<string, string>,
  image: Blob,
  signal?: AbortSignal,
): Promise<void> {
  if (!isMediaEvidenceUploadConfigured()) throw new Error('media_upload_not_configured');
  const url = new URL(uploadUrl);
  if (url.protocol !== 'https:' || url.origin !== EVIDENCE_S3_ORIGIN || url.username || url.password
    || url.search || url.hash) throw new Error('media_upload_origin_invalid');
  if (image.type !== 'image/jpeg' || image.size < 1 || image.size > 4 * 1024 * 1024)
    throw new Error('media_upload_image_invalid');
  const entries = Object.entries(uploadFields);
  if (entries.length < 1 || entries.length > 40 || entries.some(([key, value]) =>
    key === 'file' || key.length > 100 || value.length > 4096))
    throw new Error('media_upload_fields_invalid');
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  form.append('file', image, 'capture.jpg');
  const response = await fetch(url.toString(), {
    method: 'POST', body: form, mode: 'cors', credentials: 'omit', redirect: 'error', signal,
  });
  if (!response.ok) throw new Error('media_upload_failed');
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
