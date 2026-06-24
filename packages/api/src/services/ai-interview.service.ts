import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { db } from '@tims/db';
import { generateInterviewGuide } from '@tims/ai';
import { getAppUrl } from '@tims/shared';
import { logger } from '@tims/shared';
import { aiInterviewRepository } from '../repositories/ai-interview.repository';
import { analyzeAiInterview } from './ai-interview-analysis.service';

// ---------------------------------------------------------------------------
// AI Interview Service — business logic only; no db or tRPC imports.
//
// The "candidate magic-link" embeds session.candidateToken, a dedicated random
// UUID stored separately from the session PK. This prevents the session id from
// leaking via logs, traces, or recruiter UI (the id appears in many contexts;
// the token should not). Pattern mirrors the offer signing link (dedicated
// signingToken column). Task 4 resolves sessions by candidateToken.
// ---------------------------------------------------------------------------

/**
 * A single turn in an AI interview transcript.
 * Maps to ElevenLabs post-call webhook transcript item shape.
 */
export type TranscriptTurn = {
  role: string;
  message: string;
};

/**
 * Voice cost rate for ElevenLabs Conversational AI ($/minute).
 * Matches the budget gate constant in the start procedure (Task 4).
 */
const VOICE_USD_PER_MINUTE = 0.15;

/** Typed result DTO — only the fields the router/Task4 should see. */
export type AiInterviewResultDTO = {
  sessionId: string;
  interviewId: string;
  status: string;
  analysisStatus: string;
  transcript: Prisma.JsonValue | null;
  summary: Prisma.JsonValue | null;
  biasReport: Prisma.JsonValue | null;
  fitScore: number | null;
};

/** Coerce an unknown JSON value to a string array (candidate.skills is Json). */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

export const aiInterviewService = {
  /**
   * Verify the interview is in scope, call generateGuide to produce
   * guideQuestions, create the session (status:pending), and return a
   * candidate magic-link embedding the session id as the access token.
   *
   * scopeWhere is REQUIRED — a defaulted fragment fails open.
   */
  async createAiInterviewSession(args: {
    interviewId: string;
    organizationId: string;
    scopeWhere: Prisma.InterviewWhereInput;
  }): Promise<{ sessionId: string; candidateLink: string }> {
    const { interviewId, organizationId, scopeWhere } = args;

    const interview = await aiInterviewRepository.findInterviewWithContext(
      organizationId,
      interviewId,
      scopeWhere,
    );
    if (!interview) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
    }

    const { result: guideQuestions } = await generateInterviewGuide(organizationId, {
      vacancyTitle: interview.vacancy.title,
      vacancyDescription: interview.vacancy.description,
      interviewType: interview.type,
      durationMinutes: interview.duration,
      candidateTitle: interview.candidate.currentTitle,
      candidateSkills: toStringArray(interview.candidate.skills),
    });

    const elevenlabsAgentId = process.env.ELEVENLABS_AGENT_ID ?? null;

    const session = await aiInterviewRepository.createSession({
      organizationId,
      interviewId,
      candidateId: interview.candidateId,
      vacancyId: interview.vacancyId,
      status: 'pending',
      elevenlabsAgentId,
      guideQuestions: guideQuestions as Prisma.InputJsonValue,
    });

    // candidateToken is a dedicated random UUID — distinct from the PK (session.id).
    // The PK appears in logs/traces/recruiter UI; the token must not.
    const candidateLink = `${getAppUrl()}/ai-interview/${session.candidateToken}`;

    return { sessionId: session.id, candidateLink };
  },

  /**
   * Process an ElevenLabs post-call webhook payload.
   *
   * Security invariants:
   *   - Signature is verified upstream (route layer) before this is called.
   *   - Idempotent: a second delivery for the same conversation_id is a no-op.
   *   - Voice spend is logged atomically with the session update in a transaction.
   *   - Analysis trigger failure NEVER fails the webhook (catch, set 'failed', return).
   *
   * Flow:
   *   1. Look up session by elevenlabsConversationId. If none, return (no-op, 200).
   *   2. If already completed, return (idempotency guard).
   *   3. Transaction: update session fields + insert aiAgentUsageLog spend row.
   *   4. Trigger analyzeAiInterview in a non-re-throwing try/catch.
   *      On throw: update analysisStatus = 'failed'.
   */
  async processPostCallWebhook(payload: {
    conversationId: string;
    transcript: TranscriptTurn[];
    durationSeconds: number;
    audioUrl?: string;
  }): Promise<void> {
    // Step 1: Look up session by conversation id.
    const session = await aiInterviewRepository.findSessionByConversationId(payload.conversationId);
    if (!session) {
      // No matching session — delivery for an unknown conversation. No-op → 200.
      return;
    }

    // Step 2: Idempotency guard — never double-store or double-charge.
    if (session.status === 'completed') {
      return;
    }

    // Step 3: Fetch the AiAgent row for 'ai-voice-interview' to get its UUID.
    // The usage log requires an agentId FK. Resolve once outside the transaction.
    const agent = await db.aiAgent.findUnique({
      where: { slug: 'ai-voice-interview' },
      select: { id: true },
    });

    // Warn when the seed row is missing so the missed charge is observable.
    if (!agent) {
      logger.warn(
        { conversationId: payload.conversationId, sessionId: session.id },
        'ai-interview webhook: AiAgent seed row for "ai-voice-interview" not found — voice spend will NOT be logged',
      );
    }

    const costUsd = (payload.durationSeconds / 60) * VOICE_USD_PER_MINUTE;

    // Step 4: Atomic transaction — race-safe session completion + spend log.
    //
    // The pre-check (step 2) stops the common duplicate case cheaply, but two
    // concurrent deliveries can both pass the pre-check before either commits.
    // The conditional updateMany ensures exactly one delivery "wins": it only
    // updates rows where status is NOT already 'completed'.  Returns true when
    // this delivery won (count === 1), false when another delivery beat us.
    const didComplete = await db.$transaction(async (tx) => {
      const { count } = await tx.aiInterviewSession.updateMany({
        where: { id: session.id, status: { not: 'completed' } },
        data: {
          transcript: payload.transcript as Prisma.InputJsonValue,
          durationSeconds: payload.durationSeconds,
          audioUrl: payload.audioUrl ?? null,
          status: 'completed',
        },
      });

      if (count === 0) {
        // Concurrent delivery already completed this session — skip spend log.
        return false;
      }

      // Only log spend if the agent row exists; if the seed has not run yet this
      // is a non-critical omission — do not fail the webhook over it.
      if (agent) {
        await tx.aiAgentUsageLog.create({
          data: {
            agentId: agent.id,
            organizationId: session.organizationId,
            costUsd,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: payload.durationSeconds * 1000,
            cached: false,
          },
        });
      }
      return true;
    });

    // If another concurrent delivery already completed this session, stop here.
    // No analysis trigger — the winning delivery is responsible for that.
    if (!didComplete) {
      return;
    }

    // Step 5: Trigger analysis. Never re-throw — a failed analysis marks 'failed'
    // on the session but must not fail the webhook (ElevenLabs would retry otherwise).
    try {
      await analyzeAiInterview({ sessionId: session.id });
    } catch (err) {
      logger.warn(
        { sessionId: session.id, err },
        'ai-interview: analysis trigger failed; marking failed',
      );
      try {
        await db.aiInterviewSession.update({
          where: { id: session.id },
          data: { analysisStatus: 'failed' },
          select: { id: true },
        });
      } catch (updateErr) {
        logger.error(
          { sessionId: session.id, updateErr },
          'ai-interview: could not mark analysis as failed',
        );
      }
    }
  },

  /**
   * Read the AI interview result for a session, filtered by organizationId
   * AND scopeWhere (scope is propagated through the linked interview).
   *
   * scopeWhere is REQUIRED — a defaulted fragment fails open.
   */
  async getAiInterviewResult(args: {
    sessionId: string;
    organizationId: string;
    scopeWhere: Prisma.InterviewWhereInput;
  }): Promise<AiInterviewResultDTO> {
    const { sessionId, organizationId, scopeWhere } = args;

    const row = await aiInterviewRepository.findSessionResult(
      organizationId,
      sessionId,
      scopeWhere,
    );
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de entrevista no encontrada' });
    }

    // Project only the DTO — never return the raw DB row (organizationId excluded).
    return {
      sessionId: row.id,
      interviewId: row.interviewId,
      status: row.status,
      analysisStatus: row.analysisStatus,
      transcript: row.transcript,
      summary: row.summary,
      biasReport: row.biasReport,
      fitScore: row.fitScore,
    };
  },
};
