/**
 * AI Voice Interview tRPC router (Task 4).
 *
 * Four procedures:
 *   create        — permissionProcedure('interview','create'): staff creates a session + candidate link
 *   recordConsent — publicProcedure, token-authorised: candidate records consent before starting
 *   start         — publicProcedure, token-authorised: candidate starts the voice session
 *   getResult     — permissionProcedure('interview','read'): staff reads the analysed result
 *
 * Public procedures use candidateToken in the input as the credential — there is
 * no candidateProcedure for this flow: the candidate does not have a staff User row
 * and does not log in with Supabase for this magic-link journey.
 *
 * ElevenLabs dynamic_variables note: the get-signed-url endpoint does NOT support
 * server-side injection of dynamic_variables — they must be forwarded to the client
 * SDK and sent as part of `conversation_initiation_client_data`. `start` returns
 * dynamicVariables alongside the signed URL for exactly this reason; the server
 * call passes an empty object so the signed URL is clean.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { logger } from '@tims/shared';
import {
  assertAiInterviewEnabled,
  isAiInterviewEnabled,
  AI_INTERVIEW_DEFAULT_MAX_MINUTES,
} from '../services/ai-interview-access.service';
// tenantDb is used by staff-path queries (budget check reads) that run inside a
// tenant-scoped request context. systemDb (aliased as candidateDb here) is used for
// all candidate token-path writes — the public candidate flow sets no org RLS GUC.
import { db as candidateDb, tenantDb as db, AiInterviewStatus } from '@tims/db';
import { router, publicProcedure, protectedProcedure, permissionProcedure } from '../trpc';
import { assertScoped, scopeWhereFor } from '../access';
import { aiInterviewService } from '../services/ai-interview.service';
import { aiInterviewRepository } from '../repositories/ai-interview.repository';
import { getSignedUrl } from '../integrations/elevenlabs';
import { isElevenLabsConfigured } from '../lib/elevenlabs';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const candidateTokenInput = z.object({
  candidateToken: z.string().min(1).max(200),
});

// Conservative default so an unconfigured org is not unlimited;
// per-org AiAgentOrgConfig.monthlyBudget overrides this value.
const DEFAULT_VOICE_BUDGET_USD = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The fail-closed ElevenLabs configuration check now comes from `../lib/elevenlabs`.
 *
 * This file used to carry its own copy that tested only ELEVENLABS_API_KEY and
 * ELEVENLABS_AGENT_ID. That is TWO of the three vars the integration needs, and the missing
 * one — ELEVENLABS_WEBHOOK_SECRET — is the one that matters AFTER the call: with the key and
 * agent set but no secret, `start` admitted the interview, the candidate completed it, and then
 * `verifyWebhookSignature` (integrations/elevenlabs.ts:177) returned false because the secret was
 * absent. The webhook fails closed by design, so the result was never ingested: no analysis, no
 * billing, no error surfaced to anyone. A partially-configured integration looked healthy right up
 * to the point where the data was silently dropped.
 *
 * The shared helper checks all three and already existed — it was imported by nothing but tests,
 * so the correct gate shipped dead while the incomplete duplicate was the live one.
 */

/**
 * Build dynamic variables for the ElevenLabs conversation from the guide questions
 * stored in the session. These are returned to the caller for client-side forwarding
 * (ElevenLabs dynamic_variables are NOT supported as server-side query params on
 * get-signed-url — the client SDK injects them via conversation_initiation_client_data).
 */
function buildDynamicVariables(guideQuestions: Prisma.JsonValue): Record<string, string> {
  if (!guideQuestions || typeof guideQuestions !== 'object' || Array.isArray(guideQuestions)) {
    return {};
  }
  const guide = guideQuestions as Record<string, unknown>;
  // Serialise the guide questions as a compact string so the ElevenLabs agent
  // can use them as a prompt variable (e.g. {{guide_questions}}).
  return {
    guide_questions: JSON.stringify(guide),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const aiInterviewRouter = router({
  /**
   * Create an AI interview session and return a candidate magic-link.
   * Scope-guarded: the caller must be able to read the interview within their scope.
   */
  create: permissionProcedure('interview', 'create')
    .input(z.object({ interviewId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Ownership probe — fail-closed; NOT_FOUND if out-of-scope.
      await assertScoped('interview', input.interviewId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

      return aiInterviewService.createAiInterviewSession({
        interviewId: input.interviewId,
        organizationId: ctx.user.organizationId,
        scopeWhere: scopeWhere as Prisma.InterviewWhereInput,
      });
    }),

  /**
   * Record candidate consent before starting the voice session.
   * PUBLIC — token-authorised; no Supabase login required.
   * The candidateToken IS the credential: anyone who holds it is the candidate.
   */
  recordConsent: publicProcedure
    .input(
      candidateTokenInput.extend({
        textVersion: z.string().min(1).max(50),
      }),
    )
    .mutation(async ({ input }) => {
      const session = await aiInterviewRepository.findSessionByCandidateToken(input.candidateToken);
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de entrevista invalido' });
      }

      // Consent can only be recorded for sessions that have not yet started.
      if (session.status !== AiInterviewStatus.pending) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No se puede registrar consentimiento en una sesion ya iniciada',
        });
      }

      const consentedAt = new Date();

      // Write consentedAt + textVersion onto the session (explicit select — never full row).
      // Uses candidateDb (systemDb) — the public candidate path has no org RLS GUC set.
      await candidateDb.aiInterviewSession.update({
        where: { id: session.id },
        data: {
          consentedAt,
          consentTextVersion: input.textVersion,
        },
        select: { id: true },
      });

      // Upsert the organisation-level DataConsent record for this candidate.
      // DataConsent.agreedAt tracks when consent was first or last given.
      // withdrawnAt is reset to null on re-consent.
      // Uses candidateDb (systemDb) — no org RLS GUC on the public candidate path.
      await candidateDb.dataConsent.upsert({
        where: {
          subjectUserId_consentType: {
            subjectUserId: session.candidateId,
            consentType: 'ai_interview',
          },
        },
        create: {
          organizationId: session.organizationId,
          subjectUserId: session.candidateId,
          consentType: 'ai_interview',
          textVersion: input.textVersion,
          agreedAt: consentedAt,
          withdrawnAt: null,
        },
        update: {
          textVersion: input.textVersion,
          agreedAt: consentedAt,
          withdrawnAt: null,
        },
        select: { id: true },
      });

      return { success: true as const };
    }),

  /**
   * Start the voice session — exchange the server-side API key for a short-lived
   * signed WebSocket URL and return it alongside the dynamic variables the client
   * must forward to ElevenLabs.
   *
   * Gates (evaluated in this order):
   *   1. ElevenLabs must be configured (API key + agent id present). Fail-closed.
   *   2. Token must resolve to an existing session. Fail-closed.
   *   3. Session must be pending (not started / completed / expired). Fail-closed.
   *   4. Candidate must have consented (consentedAt is non-null). Fail-closed.
   *   5. Monthly voice budget — meter-and-bill, NON-BLOCKING. Never throws; logs a
   *      structured warning when month-to-date spend is over the soft cap.
   *   6. An agent id must be determinable. Fail-closed.
   *
   * PUBLIC — token-authorised; no Supabase login required.
   */
  start: publicProcedure.input(candidateTokenInput).mutation(async ({ input }) => {
    // Gate 1: ElevenLabs must be configured before any DB work.
    if (!isElevenLabsConfigured()) {
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'El servicio de entrevista de voz no esta disponible en este momento',
      });
    }

    // Gate 2: Token must resolve to a session.
    const session = await aiInterviewRepository.findSessionByCandidateToken(input.candidateToken);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Enlace de entrevista invalido' });
    }

    // Feature gate: AI Voice Interview must be enabled for this org (paid add-on).
    await assertAiInterviewEnabled(session.organizationId);

    // Gate 3: Session must still be pending.
    if (session.status !== AiInterviewStatus.pending) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Esta sesion de entrevista ya fue iniciada o ha finalizado',
      });
    }

    // Gate 4: Candidate must have consented first.
    if (!session.consentedAt) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Debe otorgar consentimiento primero',
      });
    }

    // Gate 5 (meter-and-bill, non-blocking): monthly voice spend vs soft cap.
    // Entitlement enforcement NEVER hard-blocks (owner decision, 2026-07-08) — the
    // interview always proceeds regardless of budget/usage. We still compute the
    // month-to-date spend and, when it is over the soft cap, emit a structured
    // non-blocking log so ops/billing has visibility; per-session cost continues to
    // be recorded in aiAgentUsageLog downstream by the webhook path.
    // Effective cap = per-org config.monthlyBudget if set, otherwise
    // DEFAULT_VOICE_BUDGET_USD (soft threshold for the metering log only).
    // NOTE: EffectiveEntitlement.limit for `ai_voice_interview` is denominated in
    // MINUTES (and may be null = unlimited), while this aggregate is in USD spend —
    // they are not directly comparable. Precise minute-based entitlement metering
    // and invoice line-item generation from this signal is Slice 2.
    const now = new Date();
    const config = await db.aiAgentOrgConfig.findFirst({
      where: { organizationId: session.organizationId, agent: { slug: 'ai-voice-interview' } },
      select: { monthlyBudget: true },
    });

    const effectiveCap = config?.monthlyBudget ?? DEFAULT_VOICE_BUDGET_USD;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const usageAgg = await db.aiAgentUsageLog.aggregate({
      where: {
        organizationId: session.organizationId,
        agent: { slug: 'ai-voice-interview' },
        createdAt: { gte: startOfMonth },
      },
      _sum: { costUsd: true },
    });
    const totalSpend = usageAgg._sum.costUsd ?? 0;
    if (totalSpend >= effectiveCap) {
      logger.warn(
        {
          organizationId: session.organizationId,
          module: 'ai_voice_interview',
          monthlyCapUsd: effectiveCap,
          monthToDateSpendUsd: totalSpend,
          overageUsd: totalSpend - effectiveCap,
        },
        'ai-interview: monthly voice spend over soft cap — meter-and-bill, interview proceeds',
      );
    }

    // Gate 6: Resolve the ElevenLabs agent id (session-specific → env fallback).
    const agentId = session.elevenlabsAgentId ?? process.env.ELEVENLABS_AGENT_ID ?? '';
    if (!agentId) {
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'El agente de voz no esta configurado',
      });
    }

    // Build dynamic variables from guide questions for client-side forwarding.
    // ElevenLabs' get-signed-url does NOT support server-side dynamic_variables
    // injection — the client SDK must send them via conversation_initiation_client_data.
    // We pass an empty object to getSignedUrl and return the variables separately.
    const dynamicVariables = buildDynamicVariables(session.guideQuestions);

    // Exchange the server-side API key for a short-lived signed WebSocket URL.
    // SECURITY INVARIANT: ELEVENLABS_API_KEY is ONLY placed in the xi-api-key
    // request header inside getSignedUrl; it is never included in return values.
    const result = await getSignedUrl({
      agentId,
      dynamicVariables: {}, // client-side only — see module doc above
      maxDurationSeconds: session.maxDurationSeconds ?? AI_INTERVIEW_DEFAULT_MAX_MINUTES * 60,
    });

    // Mark session as in_progress and record the conversation id for webhook correlation.
    // Uses candidateDb (systemDb) — the public candidate path has no org RLS GUC set.
    // Persist null (not '') when ElevenLabs omits conversation_id: the column is
    // @unique String? and Postgres exempts NULL from uniqueness, so multiple sessions
    // without a conversation id are safe. An empty string would cause a P2002 on the
    // second session.
    await candidateDb.aiInterviewSession.update({
      where: { id: session.id },
      data: {
        status: 'in_progress',
        elevenlabsConversationId: result.conversationId || null,
      },
      select: { id: true },
    });

    // Return the signed URL + dynamic variables for the client to forward.
    // NEVER include any API key or secret in this response.
    return {
      signedUrl: result.signedUrl,
      dynamicVariables,
      maxDurationSeconds: session.maxDurationSeconds ?? AI_INTERVIEW_DEFAULT_MAX_MINUTES * 60,
    };
  }),

  /**
   * Read the AI-analysed result for a session.
   * Scope-guarded: the caller must be able to read the underlying interview.
   */
  getResult: permissionProcedure('interview', 'read')
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

      return aiInterviewService.getAiInterviewResult({
        sessionId: input.sessionId,
        organizationId: ctx.user.organizationId,
        scopeWhere: scopeWhere as Prisma.InterviewWhereInput,
      });
    }),

  /**
   * Returns whether the AI Voice Interview add-on is enabled for the recruiter's org.
   * Recruiter-facing: any authenticated staff user may query this flag to conditionally
   * show/hide the AI interview UI. Uses protectedProcedure (tenant auth context).
   */
  isEnabled: protectedProcedure.query(async ({ ctx }) => {
    return isAiInterviewEnabled(ctx.user.organizationId);
  }),
});
