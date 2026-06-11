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
      // Verify assessment type, candidate AND vacancy all belong to the org —
      // otherwise an attacker could assign against another tenant's candidate and
      // read their PII back via getResults / listPending includes.
      const [assessmentType, candidate, vacancy] = await Promise.all([
        db.assessmentType.findFirst({ where: { id: input.assessmentTypeId, organizationId: orgId, isActive: true }, select: { id: true } }),
        db.candidate.findFirst({ where: { id: input.candidateId, organizationId: orgId }, select: { id: true } }),
        db.vacancy.findFirst({ where: { id: input.vacancyId, organizationId: orgId }, select: { id: true } }),
      ]);
      if (!assessmentType) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tipo de evaluacion no encontrado' });
      }
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
      }
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
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
      const [assessmentType, vacancy, candidateCount] = await Promise.all([
        db.assessmentType.findFirst({ where: { id: input.assessmentTypeId, organizationId: orgId, isActive: true }, select: { id: true } }),
        db.vacancy.findFirst({ where: { id: input.vacancyId, organizationId: orgId }, select: { id: true } }),
        db.candidate.count({ where: { id: { in: uniqueCandidateIds }, organizationId: orgId } }),
      ]);
      if (!assessmentType) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tipo de evaluacion no encontrado' });
      }
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
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

      const where: Prisma.AssessmentAssignmentWhereInput = {
        organizationId: ctx.user.organizationId,
        vacancyId,
        status: 'completed',
      };
      if (assessmentTypeId) where.assessmentTypeId = assessmentTypeId;

      const items = await db.assessmentAssignment.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { completedAt: 'desc' },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
          assessmentType: { select: { id: true, name: true, code: true } },
          result: true,
        },
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const extra = items.pop()!;
        nextCursor = extra.id;
      }

      return { items, nextCursor };
    }),

  // 7.5 — Get detailed result for a single assignment
  getResultDetail: permissionProcedure('assessment', 'read')
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const assignment = await db.assessmentAssignment.findFirst({
        where: { id: input.assignmentId, organizationId: ctx.user.organizationId },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
          assessmentType: true,
          result: true,
          session: true,
        },
      });

      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }

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

      const where: Prisma.AssessmentAssignmentWhereInput = {
        organizationId: ctx.user.organizationId,
        status: { in: ['assigned', 'in_progress'] },
      };
      if (vacancyId) where.vacancyId = vacancyId;

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
      const assignment = await db.assessmentAssignment.findFirst({
        where: {
          id: input.assignmentId,
          organizationId: ctx.user.organizationId,
          status: { in: ['assigned', 'in_progress'] },
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
      const assignment = await db.assessmentAssignment.findFirst({
        where: {
          id: input.assignmentId,
          organizationId: ctx.user.organizationId,
          status: { in: ['assigned', 'in_progress'] },
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
      const session = await db.proctoringSession.findFirst({
        where: {
          assignmentId: input.assignmentId,
          organizationId: ctx.user.organizationId,
        },
      });

      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de proctoring no encontrada' });
      }

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
      const session = await db.proctoringSession.findFirst({
        where: {
          assignmentId: input.assignmentId,
          organizationId: ctx.user.organizationId,
        },
      });

      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sesion de proctoring no encontrada' });
      }

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
    .query(() => {
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
      const assignments = await db.assessmentAssignment.findMany({
        where: {
          id: { in: input.assignmentIds },
          organizationId: ctx.user.organizationId,
        },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          assessmentType: { select: { id: true, name: true, code: true } },
          result: true,
        },
      });

      if (assignments.length !== input.assignmentIds.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Una o mas asignaciones no encontradas',
        });
      }

      // Sort by score descending
      const ranked = assignments
        .filter((a) => a.result)
        .sort((a, b) => (b.result?.normalizedScore ?? 0) - (a.result?.normalizedScore ?? 0))
        .map((a, idx) => ({
          rank: idx + 1,
          candidate: a.candidate,
          assessmentType: a.assessmentType,
          rawScore: a.result?.rawScore,
          normalizedScore: a.result?.normalizedScore,
          percentile: a.result?.percentile,
          breakdown: a.result?.breakdown,
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
