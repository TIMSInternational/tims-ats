import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import {
  createQuestionSchema,
  updateQuestionSchema,
  listQuestionsSchema,
  deleteQuestionSchema,
} from '@tims/shared';
import { assessmentQuestionService } from '../services/assessment-question.service';
import { scopeWhereFor, assertScoped, selectFor, logDataAccess } from '../access';

// ---------------------------------------------------------------------------
// AssessmentResult field-level gating (Wave 2.5 slice 6)
// ---------------------------------------------------------------------------
// `selectFor(roles, 'assessmentResult')` returns a runtime-built select, so
// Prisma's static result type for the relation cannot know which conditional
// fields are present. This explicit partial shape lets the mapped output read
// the score/raw fields without `any`; absent fields are simply `undefined`,
// which is exactly what we want to return to non-entitled callers.
interface AssessmentResultRow {
  id: string;
  organizationId: string;
  assignmentId: string;
  normalizedScore?: number | null;
  percentile?: number | null;
  interpretation?: string | null;
  // restricted — present ONLY when selectFor included them (super_admin):
  rawScore?: number | null;
  breakdown?: unknown;
}

/**
 * Audit every returned result. `includesRaw` (true only when the caller's
 * select carried the restricted breakdown/rawScore fields, i.e. super_admin)
 * forces fail-CLOSED auditing; a recruiter/hr reading only confidential score
 * fields is audited fail-SOFT so one lost audit row cannot abort their bulk
 * read. Awaited (Promise.all) BEFORE serialization so a fail-closed super_admin
 * read aborts pre-response.
 */
async function auditResults(
  ctx: { user: { id: string; impersonatorId?: string | null; organizationId: string }; headers: Headers },
  results: ReadonlyArray<{ id: string; assignmentId: string }>,
  includesRaw: boolean,
): Promise<void> {
  if (results.length === 0) return;
  const actorId = ctx.user.impersonatorId ?? ctx.user.id;
  const ipAddress = ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip');
  const userAgent = ctx.headers.get('user-agent');
  await Promise.all(
    results.map((r) =>
      logDataAccess(
        {
          organizationId: ctx.user.organizationId,
          actorId,
          entity: 'assessmentResult',
          recordId: r.id ?? r.assignmentId,
          action: 'read',
          ipAddress,
          userAgent,
        },
        { failClosed: includesRaw },
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const assessmentRouter = router({
  // 7.1 — List assessment types for the organization
  listTypes: permissionProcedure('assessment', 'read')
    .input(
      z.object({
        includeInactive: z.boolean().default(false),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      return db.assessmentType.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.includeInactive ? {} : { isActive: true }),
        },
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { assignments: true } },
        },
      });
    }),

  // 7.2 — Assign assessment to a candidate
  assign: permissionProcedure('assessment', 'create')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        vacancyId: z.string().uuid(),
        assessmentTypeId: z.string().uuid(),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.user.organizationId;

      // Probe parent vacancy through scope — a narrow-scoped user must only
      // assign assessments for vacancies they can reach, not org-wide.
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, orgId);

      // AssessmentType and candidate get plain org-checks (not scope-filtered:
      // assessment types are org-catalog items; users are permitted to assess
      // any org candidate once the vacancy is in scope).
      const [assessmentType, candidate] = await Promise.all([
        db.assessmentType.findFirst({ where: { id: input.assessmentTypeId, organizationId: orgId, isActive: true }, select: { id: true } }),
        db.candidate.findFirst({ where: { id: input.candidateId, organizationId: orgId }, select: { id: true } }),
      ]);
      if (!assessmentType) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tipo de evaluacion no encontrado' });
      }
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }

      return db.assessmentAssignment.create({
        data: {
          organizationId: ctx.user.organizationId,
          candidateId: input.candidateId,
          vacancyId: input.vacancyId,
          assessmentTypeId: input.assessmentTypeId,
          assignedById: ctx.user.id,
          status: 'assigned',
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        },
        include: {
          assessmentType: { select: { id: true, name: true, code: true } },
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    }),

  // 7.3 — Bulk assign assessment to multiple candidates
  bulkAssign: permissionProcedure('assessment', 'create')
    .input(
      z.object({
        candidateIds: z.array(z.string().uuid()).min(1).max(200),
        vacancyId: z.string().uuid(),
        assessmentTypeId: z.string().uuid(),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.user.organizationId;
      const uniqueCandidateIds = [...new Set(input.candidateIds)];

      // Probe parent vacancy through scope once (one vacancyId, many candidates).
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, orgId);

      const [assessmentType, candidateCount] = await Promise.all([
        db.assessmentType.findFirst({ where: { id: input.assessmentTypeId, organizationId: orgId, isActive: true }, select: { id: true } }),
        db.candidate.count({ where: { id: { in: uniqueCandidateIds }, organizationId: orgId } }),
      ]);
      if (!assessmentType) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tipo de evaluacion no encontrado' });
      }
      if (candidateCount !== uniqueCandidateIds.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Uno o mas candidatos no encontrados en esta organizacion' });
      }

      const result = await db.assessmentAssignment.createMany({
        data: input.candidateIds.map((candidateId) => ({
          organizationId: ctx.user.organizationId,
          candidateId,
          vacancyId: input.vacancyId,
          assessmentTypeId: input.assessmentTypeId,
          assignedById: ctx.user.id,
          status: 'assigned',
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        })),
        skipDuplicates: true,
      });

      return { assigned: result.count };
    }),

  // 7.4 — Get results for a vacancy (all candidates)
  getResults: permissionProcedure('assessment', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid(),
        assessmentTypeId: z.string().uuid().optional(),
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, vacancyId, assessmentTypeId } = input;
      const scopeWhere = await scopeWhereFor('assessmentAssignment', ctx.access, ctx.user.id);

      // Field-level gating: only the result fields this caller's roles may read
      // are SELECTed (raw breakdown/rawScore for super_admin only). Never select
      // a restricted field and null it afterward — it would still leave the DB.
      const resultSelect = selectFor(ctx.access.roles, 'assessmentResult');
      const includesRaw = 'breakdown' in resultSelect || 'rawScore' in resultSelect;

      const where: Prisma.AssessmentAssignmentWhereInput = {
        AND: [
          {
            organizationId: ctx.user.organizationId,
            vacancyId,
            status: 'completed',
            ...(assessmentTypeId ? { assessmentTypeId } : {}),
          },
          scopeWhere as Prisma.AssessmentAssignmentWhereInput,
        ],
      };

      const items = await db.assessmentAssignment.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { completedAt: 'desc' },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
          assessmentType: { select: { id: true, name: true, code: true } },
          result: { select: resultSelect },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const extra = items.pop()!;
        nextCursor = extra.id;
      }

      // Audit each returned result BEFORE serialization (Promise.all). For a
      // super_admin (includesRaw) a failed audit write fails-closed and aborts.
      const presentResults = items
        .map((i) => i.result as AssessmentResultRow | null)
        .filter((r): r is AssessmentResultRow => r != null);
      await auditResults(ctx, presentResults, includesRaw);

      return { items, nextCursor };
    }),

  // 7.5 — Get detailed result for a single assignment
  getResultDetail: permissionProcedure('assessment', 'read')
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Probe first — the subsequent findFirst uses `include` (no `select`), and
      // Prisma does not support mixing AND scope fragments with `include` in a
      // type-safe way; the two-query pattern keeps the full include block intact
      // while still enforcing scope.
      await assertScoped('assessmentAssignment', input.assignmentId, ctx.access, ctx.user.id, ctx.user.organizationId);

      // Field-level gating on the result relation (raw breakdown/rawScore are
      // super_admin only). Other relations are non-psychometric and unchanged.
      const resultSelect = selectFor(ctx.access.roles, 'assessmentResult');
      const includesRaw = 'breakdown' in resultSelect || 'rawScore' in resultSelect;

      const assignment = await db.assessmentAssignment.findFirst({
        where: { id: input.assignmentId, organizationId: ctx.user.organizationId },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
          assessmentType: true,
          result: { select: resultSelect },
          session: true,
        },
      });

      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }

      // Audit the result read BEFORE returning (fail-closed for super_admin raw).
      const result = assignment.result as AssessmentResultRow | null;
      if (result) await auditResults(ctx, [result], includesRaw);

      return assignment;
    }),

  // 7.6 — List pending assessments (not yet completed)
  listPending: permissionProcedure('assessment', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid().optional(),
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, vacancyId } = input;
      const scopeWhere = await scopeWhereFor('assessmentAssignment', ctx.access, ctx.user.id);

      const where: Prisma.AssessmentAssignmentWhereInput = {
        AND: [
          {
            organizationId: ctx.user.organizationId,
            status: { in: ['assigned', 'in_progress'] },
            ...(vacancyId ? { vacancyId } : {}),
          },
          scopeWhere as Prisma.AssessmentAssignmentWhereInput,
        ],
      };

      const items = await db.assessmentAssignment.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { assignedAt: 'desc' },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
          assessmentType: { select: { id: true, name: true, code: true, duration: true } },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const extra = items.pop()!;
        nextCursor = extra.id;
      }

      return { items, nextCursor };
    }),

  // 7.7 — Cancel an assessment assignment
  cancel: permissionProcedure('assessment', 'update')
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('assessmentAssignment', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it also checks the `status`
      // business condition, so we cannot replace it with a bare assertScoped.
      const assignment = await db.assessmentAssignment.findFirst({
        where: {
          AND: [
            {
              id: input.assignmentId,
              organizationId: ctx.user.organizationId,
              status: { in: ['assigned', 'in_progress'] },
            },
            scopeWhere as Prisma.AssessmentAssignmentWhereInput,
          ],
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Asignacion no encontrada o ya completada/cancelada',
        });
      }

      return db.assessmentAssignment.update({
        where: { id: input.assignmentId },
        data: { status: 'cancelled' },
      });
    }),

  // 7.8 — Resend assessment invitation (stub)
  resend: permissionProcedure('assessment', 'update')
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('assessmentAssignment', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it checks the `status`
      // business condition and its `include` block feeds the response payload.
      const assignment = await db.assessmentAssignment.findFirst({
        where: {
          AND: [
            {
              id: input.assignmentId,
              organizationId: ctx.user.organizationId,
              status: { in: ['assigned', 'in_progress'] },
            },
            scopeWhere as Prisma.AssessmentAssignmentWhereInput,
          ],
        },
        include: {
          candidate: { select: { email: true, firstName: true } },
          assessmentType: { select: { name: true } },
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Asignacion no encontrada o no reenviar invitaciones para evaluaciones completadas',
        });
      }

      // Stub: in production this would trigger an SES email
      await db.assessmentAssignment.update({
        where: { id: input.assignmentId },
        data: { reminderSentAt: new Date() },
      });

      return {
        sent: true,
        to: assignment.candidate.email,
        assessmentName: assignment.assessmentType.name,
        status: 'stub_sent',
      };
    }),

  // 7.9 — Get proctoring events for an assignment
  getProctoringEvents: permissionProcedure('assessment', 'read')
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Fetch-then-probe hop: ProctoringSession is keyed by assignmentId (no
      // direct scope policy on it). Fetch the session org-scoped first, then
      // probe the assignment it belongs to — ensures the caller can reach it.
      const session = await db.proctoringSession.findFirst({
        where: {
          assignmentId: input.assignmentId,
          organizationId: ctx.user.organizationId,
        },
      });

      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de proctoring no encontrada' });
      }

      await assertScoped('assessmentAssignment', session.assignmentId, ctx.access, ctx.user.id, ctx.user.organizationId);

      return {
        sessionId: session.id,
        assignmentId: session.assignmentId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        flagCount: session.flagCount,
        severity: session.severity,
        events: session.events,
      };
    }),

  // 7.10 — Flag a proctoring event
  flagProctoring: permissionProcedure('assessment', 'update')
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        event: z.object({
          type: z.string().max(100),
          description: z.string().max(1000),
          timestamp: z.string().datetime(),
          severity: z.enum(['low', 'medium', 'high', 'critical']),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch-then-probe hop (same as getProctoringEvents — see comment there).
      const session = await db.proctoringSession.findFirst({
        where: {
          assignmentId: input.assignmentId,
          organizationId: ctx.user.organizationId,
        },
      });

      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de proctoring no encontrada' });
      }

      await assertScoped('assessmentAssignment', session.assignmentId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const existingEvents = (session.events as Array<Record<string, unknown>>) ?? [];
      const updatedEvents = [...existingEvents, input.event];

      // Determine highest severity
      const severityOrder = ['low', 'medium', 'high', 'critical'];
      const maxSeverity = updatedEvents.reduce<string>((max, e) => {
        const sev = (e as Record<string, unknown>).severity as string | undefined;
        const eSev = severityOrder.indexOf(sev ?? 'low');
        const mSev = severityOrder.indexOf(max);
        return eSev > mSev ? (sev ?? 'low') : max;
      }, session.severity ?? 'low');

      return db.proctoringSession.update({
        where: { id: session.id },
        data: {
          events: updatedEvents as unknown as Prisma.JsonArray,
          flagCount: { increment: 1 },
          severity: maxSeverity,
        },
      });
    }),

  // 7.11 — AI explainability for an assessment result.
  // NOT IMPLEMENTED: the assessment-evaluator agent is not built yet (Wave 3).
  // Returns 501 rather than fabricated strengths/weaknesses + a fake confidence
  // score and 'bedrock-claude-v1-stub' modelVersion (rule #4: no stub may
  // impersonate a real AI feature). Wire the gated agent here when it lands.
  getExplainability: permissionProcedure('assessment', 'read')
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Defense-in-depth: scope-probe before the 501 so a narrow-scoped user
      // cannot enumerate assignment ids via timing or error-code differences.
      await assertScoped('assessmentAssignment', input.assignmentId, ctx.access, ctx.user.id, ctx.user.organizationId);
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'La explicabilidad con IA aun no esta disponible (agente de evaluacion pendiente).',
      });
    }),

  // 7.12 — Compare assessment results for multiple candidates
  compare: permissionProcedure('assessment', 'read')
    .input(
      z.object({
        assignmentIds: z.array(z.string().uuid()).min(2).max(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const uniqueIds = [...new Set(input.assignmentIds)];
      const scopeWhere = await scopeWhereFor('assessmentAssignment', ctx.access, ctx.user.id);

      // Count-check pattern: a single scoped count confirms every id in the set
      // is reachable under the caller's scope. AssessmentAssignment has no
      // deletedAt column so no soft-delete guard is needed here.
      const scopedCount = await db.assessmentAssignment.count({
        where: {
          AND: [
            { id: { in: uniqueIds }, organizationId: ctx.user.organizationId },
            scopeWhere as Prisma.AssessmentAssignmentWhereInput,
          ],
        },
      });

      if (scopedCount !== uniqueIds.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Una o mas asignaciones no encontradas',
        });
      }

      // Field-level gating: a recruiter (assessment:read) gets normalizedScore/
      // percentile/interpretation only — NOT rawScore/breakdown (super_admin).
      const resultSelect = selectFor(ctx.access.roles, 'assessmentResult');
      const includesRaw = 'breakdown' in resultSelect || 'rawScore' in resultSelect;

      const assignments = await db.assessmentAssignment.findMany({
        where: {
          id: { in: uniqueIds },
          organizationId: ctx.user.organizationId,
        },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          assessmentType: { select: { id: true, name: true, code: true } },
          result: { select: resultSelect },
        },
      });

      // Audit every result read BEFORE serialization. For super_admin (includesRaw)
      // a failed audit write fails-closed and aborts the whole compare; for a
      // recruiter/hr it fails-soft so one lost row cannot break a 10-candidate compare.
      const presentResults = assignments
        .map((a) => a.result as AssessmentResultRow | null)
        .filter((r): r is AssessmentResultRow => r != null);
      await auditResults(ctx, presentResults, includesRaw);

      // Sort by score descending. rawScore/breakdown are read through the typed
      // partial shape — `undefined` (omitted from the payload) for non-super callers
      // since selectFor never SELECTed them, so they never leave the DB.
      const ranked = assignments
        .map((a) => ({ a, result: a.result as AssessmentResultRow | null }))
        .filter((x): x is { a: (typeof assignments)[number]; result: AssessmentResultRow } => x.result != null)
        .sort((x, y) => (y.result.normalizedScore ?? 0) - (x.result.normalizedScore ?? 0))
        .map(({ a, result }, idx) => ({
          rank: idx + 1,
          candidate: a.candidate,
          assessmentType: a.assessmentType,
          rawScore: result.rawScore ?? undefined,
          normalizedScore: result.normalizedScore ?? undefined,
          percentile: result.percentile ?? undefined,
          breakdown: result.breakdown ?? undefined,
        }));

      const unscored = assignments
        .filter((a) => !a.result)
        .map((a) => ({
          candidate: a.candidate,
          assessmentType: a.assessmentType,
          status: a.status,
        }));

      return { ranked, unscored };
    }),

  // -------------------------------------------------------------------------
  // Question authoring (Wave 1.5a slice 1). Clean arch: router → service → repo.
  // Coherence (type ↔ options ↔ correct ids) enforced in the service.
  // -------------------------------------------------------------------------

  // 7.13 — List questions for an assessment type. Authoring view: the DTO
  // includes the answer key (correctOptionIds), so it requires the authoring
  // permission ('update'), NOT the broad 'read' shared with result viewers.
  listQuestions: permissionProcedure('assessment', 'update')
    .input(listQuestionsSchema)
    .query(({ ctx, input }) => assessmentQuestionService.list(ctx.user.organizationId, input)),

  // 7.14 — Create a question
  createQuestion: permissionProcedure('assessment', 'create')
    .input(createQuestionSchema)
    .mutation(({ ctx, input }) =>
      assessmentQuestionService.create(ctx.user.organizationId, input),
    ),

  // 7.15 — Update a question
  updateQuestion: permissionProcedure('assessment', 'update')
    .input(updateQuestionSchema)
    .mutation(({ ctx, input }) =>
      assessmentQuestionService.update(ctx.user.organizationId, input),
    ),

  // 7.16 — Delete a question
  deleteQuestion: permissionProcedure('assessment', 'delete')
    .input(deleteQuestionSchema)
    .mutation(({ ctx, input }) =>
      assessmentQuestionService.remove(ctx.user.organizationId, input.id),
    ),
});
