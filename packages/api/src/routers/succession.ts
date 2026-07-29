import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, requireOrgScope } from '../access';

export const successionRouter = router({
  // ── Critical Roles ───────────────────────────────────────────────────

  getCriticalRole: permissionProcedure('succession', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // By-id read → scope-probe the role (NOT_FOUND if out of the caller's grant).
      await assertScoped('criticalRole', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);
      const successorScope = await scopeWhereFor('successor', ctx.access, ctx.user.id);
      return db.criticalRole.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          currentHolder: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              jobTitle: true,
              email: true,
            },
          },
          successors: {
            where: successorScope as Prisma.SuccessorWhereInput,
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                  jobTitle: true,
                },
              },
              addedByUser: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    }),

  addCriticalRole: permissionProcedure('succession', 'create')
    .input(
      z.object({
        title: z.string().min(1).max(255),
        positionId: z.string().max(100).optional(),
        currentHolderId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        unitId: z.string().uuid().optional(),
        criticality: z.enum(['critical', 'high', 'medium', 'low']),
        flightRisk: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Defining an org-critical role is org governance, not a leader/hrbp
      // grant (matrix gives them read only) → org/company scope only.
      requireOrgScope(ctx.access);
      const orgId = ctx.user.organizationId;
      // Codex H2 hardening (both-stacks parity with the C# strangler port): the create persists arbitrary
      // currentHolderId/companyId/unitId — FK checks bypass RLS, so an org-scoped creator could otherwise anchor
      // a role to another tenant's employee or foreign org structure. Validate each PROVIDED optional reference
      // against the caller's org before the INSERT; a cross-org / nonexistent id → BAD_REQUEST (never persisted).
      if (input.currentHolderId) {
        const holder = await db.user.findFirst({
          where: { id: input.currentHolderId, organizationId: orgId },
          select: { id: true },
        });
        if (!holder) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Referencia invalida' });
      }
      if (input.companyId) {
        const company = await db.company.findFirst({
          where: { id: input.companyId, organizationId: orgId },
          select: { id: true },
        });
        if (!company) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Referencia invalida' });
      }
      if (input.unitId) {
        const unit = await db.businessUnit.findFirst({
          where: { id: input.unitId, organizationId: orgId },
          select: { id: true },
        });
        if (!unit) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Referencia invalida' });
      }
      return db.criticalRole.create({
        data: {
          ...input,
          organizationId: orgId,
        },
      });
    }),

  // ── Successors ───────────────────────────────────────────────────────

  removeSuccessor: permissionProcedure('succession', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('successor', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);
      return db.successor.delete({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });
    }),

  updateSuccessorReadiness: permissionProcedure('succession', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        readiness: z.enum(['ready_now', 'ready_1_year', 'ready_2_years', 'developing']),
        developmentPlan: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await assertScoped('successor', id, ctx.access, ctx.user.id, ctx.user.organizationId);
      return db.successor.update({
        where: { id, organizationId: ctx.user.organizationId },
        data,
      });
    }),
});
