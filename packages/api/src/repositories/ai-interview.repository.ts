import { db as systemDb, tenantDb as db } from '@tims/db';
import type { Prisma, AiInterviewStatus } from '@tims/db';

// ---------------------------------------------------------------------------
// AI Interview Repository — thin Prisma wrappers with explicit select.
// Scope is always AND-composed: organizationId + caller-supplied scopeWhere.
// Repositories never default the scope fragment — a missing scope fails open.
// ---------------------------------------------------------------------------

/** Minimal interview context needed by the guide-generation step. */
const INTERVIEW_CONTEXT_SELECT = {
  id: true,
  organizationId: true,
  candidateId: true,
  vacancyId: true,
  type: true,
  duration: true,
  candidate: {
    select: { firstName: true, lastName: true, currentTitle: true, skills: true },
  },
  vacancy: { select: { title: true, description: true } },
} satisfies Prisma.InterviewSelect;

/** Result DTO fields — only what the service needs to expose, never the full row. */
const SESSION_RESULT_SELECT = {
  id: true,
  organizationId: true,
  interviewId: true,
  status: true,
  analysisStatus: true,
  transcript: true,
  summary: true,
  biasReport: true,
  fitScore: true,
} satisfies Prisma.AiInterviewSessionSelect;

const SESSION_CREATE_SELECT = {
  id: true,
  organizationId: true,
  interviewId: true,
  candidateId: true,
  vacancyId: true,
  status: true,
  candidateToken: true,
} satisfies Prisma.AiInterviewSessionSelect;

/** Public candidate-flow fields resolved by candidateToken (token IS the credential). */
const SESSION_CANDIDATE_SELECT = {
  id: true,
  organizationId: true,
  candidateId: true,
  status: true,
  consentedAt: true,
  elevenlabsAgentId: true,
  guideQuestions: true,
  maxDurationSeconds: true,
} satisfies Prisma.AiInterviewSessionSelect;

/**
 * Fields needed by the post-call webhook service to complete a session.
 * Includes analysisStatus so the webhook handler can update it on analysis failure.
 */
const SESSION_WEBHOOK_SELECT = {
  id: true,
  organizationId: true,
  status: true,
  durationSeconds: true,
  analysisStatus: true,
} satisfies Prisma.AiInterviewSessionSelect;

export type InterviewContextRow = NonNullable<
  Awaited<ReturnType<typeof aiInterviewRepository.findInterviewWithContext>>
>;

export type SessionResultRow = NonNullable<
  Awaited<ReturnType<typeof aiInterviewRepository.findSessionResult>>
>;

export type SessionWebhookRow = NonNullable<
  Awaited<ReturnType<typeof aiInterviewRepository.findSessionByConversationId>>
>;

export type CreateSessionInput = {
  organizationId: string;
  interviewId: string;
  candidateId: string;
  vacancyId: string;
  status: AiInterviewStatus;
  elevenlabsAgentId: string | null;
  guideQuestions: Prisma.InputJsonValue;
  maxDurationSeconds: number;
};

export const aiInterviewRepository = {
  /**
   * Fetch the interview + candidate + vacancy context the guide agent needs.
   * AND-composes organizationId + scopeWhere so the scope is never dropped.
   */
  findInterviewWithContext(
    organizationId: string,
    interviewId: string,
    scopeWhere: Prisma.InterviewWhereInput,
  ) {
    return db.interview.findFirst({
      where: {
        AND: [{ id: interviewId, organizationId }, scopeWhere],
      },
      select: INTERVIEW_CONTEXT_SELECT,
    });
  },

  /** Create a new pending AI interview session. Returns only safe fields. */
  createSession(data: CreateSessionInput) {
    return db.aiInterviewSession.create({
      data: {
        organizationId: data.organizationId,
        interviewId: data.interviewId,
        candidateId: data.candidateId,
        vacancyId: data.vacancyId,
        status: data.status,
        elevenlabsAgentId: data.elevenlabsAgentId,
        guideQuestions: data.guideQuestions,
        maxDurationSeconds: data.maxDurationSeconds,
      },
      select: SESSION_CREATE_SELECT,
    });
  },

  /**
   * Resolve a session by its candidateToken for the public candidate-facing endpoint.
   * Uses the raw system db (not tenantDb) because the candidate token flow has no org
   * RLS context — the token IS the credential, and organizationId is returned so the
   * caller can scope downstream operations. No cross-tenant exposure: a token can only
   * resolve the single session it was minted for.
   */
  findSessionByCandidateToken(candidateToken: string) {
    return systemDb.aiInterviewSession.findUnique({
      where: { candidateToken },
      select: SESSION_CANDIDATE_SELECT,
    });
  },

  /**
   * Fetch result fields for a session.
   * AND-composes organizationId + scopeWhere (scope propagated via linked interview).
   */
  findSessionResult(
    organizationId: string,
    sessionId: string,
    scopeWhere: Prisma.InterviewWhereInput,
  ) {
    return db.aiInterviewSession.findFirst({
      where: {
        AND: [
          { id: sessionId, organizationId },
          { interview: scopeWhere },
        ],
      },
      select: SESSION_RESULT_SELECT,
    });
  },

  /**
   * Resolve a session by ElevenLabs conversation id for the post-call webhook.
   * Uses the raw system db (not tenantDb) because the webhook has no org RLS context.
   * Returns only the fields the webhook service needs.
   */
  findSessionByConversationId(elevenlabsConversationId: string) {
    return systemDb.aiInterviewSession.findUnique({
      where: { elevenlabsConversationId },
      select: SESSION_WEBHOOK_SELECT,
    });
  },
};
