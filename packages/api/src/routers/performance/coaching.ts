import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, assertSubjectInScope } from '../../access';

export const performanceCoachingRouter = router({
  // 11.6 — List coaching sessions
  listCoachingSessions: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        employeeId: z.string().uuid().optional(),
        leaderId: z.string().uuid().optional(),
        status: z.string().max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, employeeId, leaderId, status } = input;
      const scopeWhere = (await scopeWhereFor('coachingSession', ctx.access, ctx.user.id)) as Prisma.CoachingSessionWhereInput;

      const where: Prisma.CoachingSessionWhereInput = {
        AND: [
          { organizationId: ctx.user.organizationId },
          scopeWhere,
          {
            ...(employeeId ? { employeeId } : {}),
            ...(leaderId ? { leaderId } : {}),
            ...(status ? { status } : {}),
          },
        ],
      };

      const sessions = await db.coachingSession.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { scheduledAt: 'desc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          leader: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          _count: { select: { commitments: true } },
        },
      });

      let nextCursor: string | undefined;
      if (sessions.length > limit) {
        const nextItem = sessions.pop();
        nextCursor = nextItem?.id;
      }

      return { sessions, nextCursor };
    }),

  // 11.7 — Create coaching session
  createCoachingSession: permissionProcedure('performance', 'create')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        leaderId: z.string().uuid(),
        scheduledAt: z.coerce.date(),
        duration: z.number().int().positive().optional(),
        topic: z.string().min(1).max(500),
        type: z.string().max(100).default('scheduled'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Narrow scopes may only schedule coaching for employees in their subject set.
      await assertSubjectInScope(
        ctx.access,
        ctx.user.id,
        input.employeeId,
        'No puedes crear sesiones de coaching para este empleado',
      );

      return db.coachingSession.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          leader: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 11.8 — Complete coaching session
  completeCoachingSession: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z.string().max(20000).optional(),
        duration: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Scope + IDOR probe: a narrow scope must not complete an out-of-scope session.
      await assertScoped('coachingSession', id, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.coachingSession.update({
        where: { id },
        data: {
          ...data,
          status: 'completed',
        },
        include: {
          commitments: true,
        },
      });
    }),

  // 11.9 — List commitments
  listCommitments: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        employeeId: z.string().uuid().optional(),
        coachingSessionId: z.string().uuid().optional(),
        status: z.string().max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, employeeId, coachingSessionId, status } = input;

      const scopeWhere = await scopeWhereFor('commitment', ctx.access, ctx.user.id);
      const where: Prisma.CommitmentWhereInput = {
        AND: [
          { organizationId: ctx.user.organizationId },
          scopeWhere as Prisma.CommitmentWhereInput,
          {
            ...(employeeId ? { employeeId } : {}),
            ...(coachingSessionId ? { coachingSessionId } : {}),
            ...(status ? { status } : {}),
          },
        ],
      };

      const commitments = await db.commitment.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { dueDate: 'asc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          session: { select: { id: true, topic: true, scheduledAt: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      let nextCursor: string | undefined;
      if (commitments.length > limit) {
        const nextItem = commitments.pop();
        nextCursor = nextItem?.id;
      }

      return { commitments, nextCursor };
    }),

  // 11.9b — My commitments (employee own surface — my coaching commitments)
  // Own-scoped read for the employee My Home landing. Resolves the subject via
  // the registered `commitment` entity (own → OR(employeeId=me, createdById=me)),
  // AND-composed with organizationId exactly like listLeaderCommitments — the
  // fragment is a discrete AND element, never spread. NO requireOrgScope (that
  // would FORBID the own-scoped caller). No userId/employeeId input: the subject
  // is the caller. Explicit select, bounded take.
  myCommitments: permissionProcedure('performance', 'read')
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(25),
        status: z.string().max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, status } = input;

      const scopeWhere = await scopeWhereFor('commitment', ctx.access, ctx.user.id);
      const where: Prisma.CommitmentWhereInput = {
        AND: [
          { organizationId: ctx.user.organizationId },
          scopeWhere as Prisma.CommitmentWhereInput,
          {
            ...(status ? { status } : {}),
          },
        ],
      };

      const commitments = await db.commitment.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { dueDate: 'asc' },
        select: {
          id: true,
          description: true,
          status: true,
          dueDate: true,
          completedAt: true,
        },
      });

      let nextCursor: string | undefined;
      if (commitments.length > limit) {
        const nextItem = commitments.pop();
        nextCursor = nextItem?.id;
      }

      return { commitments, nextCursor };
    }),

  // 11.10 — Create commitment
  createCommitment: permissionProcedure('performance', 'create')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        coachingSessionId: z.string().uuid().optional(),
        description: z.string().min(1).max(1000),
        dueDate: z.coerce.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Codex: the committed employee must be in the caller's subject set; an
      // optional parent session must itself be in scope.
      await assertSubjectInScope(ctx.access, ctx.user.id, input.employeeId, 'No puedes crear compromisos para este usuario');
      if (input.coachingSessionId) {
        await assertScoped('coachingSession', input.coachingSessionId, ctx.access, ctx.user.id, ctx.user.organizationId);
        // Codex: the parent session must belong to the SAME employee — without
        // this, a commitment can be attached to another employee's session
        // (data corruption + session metadata leak through the include).
        const session = await db.coachingSession.findFirst({
          where: { id: input.coachingSessionId, organizationId: ctx.user.organizationId, employeeId: input.employeeId },
          select: { id: true },
        });
        if (!session) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'La sesion no corresponde a este empleado' });
        }
      }
      return db.commitment.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    }),

  // 11.11 — Update commitment
  updateCommitment: permissionProcedure('performance', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        description: z.string().min(1).max(1000).optional(),
        dueDate: z.coerce.date().optional(),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, status, ...rest } = input;
      // Codex: was a bare update-by-id with NO org/ownership check at all.
      await assertScoped('commitment', id, ctx.access, ctx.user.id, ctx.user.organizationId);

      return db.commitment.update({
        where: { id },
        data: {
          ...rest,
          ...(status ? { status } : {}),
          ...(status === 'completed' ? { completedAt: new Date() } : {}),
        },
      });
    }),
});
