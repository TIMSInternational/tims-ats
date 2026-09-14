import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { scopeWhereFor, assertScoped, buildAccessForUser, createAnchorLoader } from '../../access';
import { filterStaffRoleSlugs } from '@tims/shared';

// ---------------------------------------------------------------------------
// Shared selects
// ---------------------------------------------------------------------------

const approvalSelect = {
  id: true,
  step: true,
  status: true,
  comment: true,
  decidedAt: true,
  approver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
} as const;

const vacancyWithApprovalsSelect = {
  id: true,
  title: true,
  status: true,
  approvals: { orderBy: { step: 'asc' as const }, select: approvalSelect },
} as const;

// ---------------------------------------------------------------------------
// Approvals sub-router
// ---------------------------------------------------------------------------

export const vacancyApprovalsRouter = router({
  submitForApproval: permissionProcedure('vacancy', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        approverIds: z.array(z.string().uuid()).min(1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const vacancy = await db.vacancy.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId, status: 'draft', deletedAt: null },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada o no esta en borrador' });
      }

      // Validate every approverId server-side (Codex PR #120 finding #3): without
      // this, a vacancy can get assigned to a nonexistent/inactive/wrong-org user,
      // or one who doesn't hold vacancy:approve, silently stuck in
      // pending_approval forever. Reject the WHOLE submission if any ID fails.
      const approvers = await db.user.findMany({
        where: { id: { in: input.approverIds }, organizationId: ctx.user.organizationId, isActive: true },
        select: { id: true, userRoles: { select: { role: { select: { slug: true } } } } },
      });
      const approversById = new Map(approvers.map((u) => [u.id, u]));

      for (const approverId of input.approverIds) {
        const approver = approversById.get(approverId);
        if (!approver) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Uno o mas aprobadores no son validos (inactivo, de otra organizacion, o inexistente)',
          });
        }
        const roles = filterStaffRoleSlugs(approver.userRoles.map((ur) => ur.role.slug));
        const approverAccess = await buildAccessForUser(
          { id: approver.id, organizationId: ctx.user.organizationId, roles, isPlatformOwner: false },
          'vacancy',
          'approve',
        );
        if (!approverAccess.allowed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Uno o mas aprobadores no tienen permiso para aprobar vacantes',
          });
        }

        // Codex PR #120 round-2 re-review: the check above only confirms the
        // approver holds vacancy:approve at the MODULE level -- vacancy:approve can
        // be a scope-limited grant (own < team < unit < company < organization), so
        // a team-scoped approver could still be assigned to a vacancy outside their
        // scope. approve() enforces per-vacancy scope via assertScoped and would
        // reject them later, leaving the vacancy stuck in pending_approval forever
        // (the exact failure mode finding #3 was meant to close, one level down).
        // Probe THIS vacancy against the APPROVER's own access, not the caller's.
        const approverAccessContext = {
          allowed: true as const,
          scope: approverAccess.scope,
          roles: approverAccess.roles,
          anchors: createAnchorLoader(ctx.user.organizationId, approverId),
        };
        try {
          await assertScoped('vacancy', input.id, approverAccessContext, approverId, ctx.user.organizationId);
        } catch (err) {
          // assertScoped throws NOT_FOUND specifically for scope denial (see
          // scoped-probe.ts) — translate only that into a submission-level
          // rejection. Any other error (DB failure, internal bug) must propagate
          // unchanged rather than being silently reported as an out-of-scope
          // approver, which would mask real failures.
          if (err instanceof TRPCError && err.code === 'NOT_FOUND') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Uno o mas aprobadores no tienen esta vacante dentro de su alcance',
            });
          }
          throw err;
        }
      }

      // runTenantTransaction, NOT db.$transaction: `db` here is `tenantDb`, whose
      // $allOperations extension gives every op its OWN mini-transaction on the base
      // client (tenant-client.ts:40). An outer tenantDb.$transaction therefore does
      // NOT compose — each write commits independently (prisma/prisma#17948), so a
      // mid-way failure left the vacancy in pending_approval with no approval rows.
      // Reproduced on a local PG17 cluster 2026-08-06 (#45): after a deliberate
      // failure the old code left status=pending_approval + 1 approval row COMMITTED;
      // runTenantTransaction left status=draft + 0 rows.
      return runTenantTransaction(ctx.user.organizationId, async (tx) => {
        await tx.vacancy.update({
          where: { id: input.id },
          data: { status: 'pending_approval' },
        });

        await tx.vacancyApproval.createMany({
          data: input.approverIds.map((approverId, idx) => ({
            organizationId: ctx.user.organizationId,
            vacancyId: input.id,
            approverId,
            step: idx + 1,
            status: 'pending',
          })),
        });

        return tx.vacancy.findUniqueOrThrow({
          where: { id: input.id },
          select: vacancyWithApprovalsSelect,
        });
      });
    }),

  approve: permissionProcedure('vacancy', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        comment: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
        select: { id: true },
      });
      if (!approval) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay aprobacion pendiente para este usuario' });
      }

      // Codex PR #120 finding #5: the approval-update + pending-count +
      // vacancy-status-update sequence was three separate writes -- a failure
      // between them could leave the vacancy's status inconsistent with its
      // approvals. Wrap in one transaction; the final read stays outside (it's a
      // read, and reflects whatever the transaction committed).
      // NOTE (#45): that wrapping was `db.$transaction` = `tenantDb.$transaction`,
      // which does NOT compose (prisma/prisma#17948) -- the finding above was
      // therefore still open. runTenantTransaction is the construct that closes it.
      await runTenantTransaction(ctx.user.organizationId, async (tx) => {
        await tx.vacancyApproval.update({
          where: { id: approval.id },
          data: { status: 'approved', comment: input.comment, decidedAt: new Date() },
        });

        const pendingCount = await tx.vacancyApproval.count({
          where: { vacancyId: input.id, status: 'pending' },
        });

        if (pendingCount === 0) {
          await tx.vacancy.update({
            where: { id: input.id },
            data: { status: 'approved' },
          });
        }
      });

      return db.vacancy.findUniqueOrThrow({
        where: { id: input.id },
        select: vacancyWithApprovalsSelect,
      });
    }),

  reject: permissionProcedure('vacancy', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        comment: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const approval = await db.vacancyApproval.findFirst({
        where: {
          vacancyId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
        select: { id: true },
      });
      if (!approval) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay aprobacion pendiente para este usuario' });
      }

      // runTenantTransaction per #45 — see submitForApproval above. This block is the
      // worst of the three under the old code: reject did status->draft, then
      // cancelled the remaining pending approvals. A failure between those two left
      // the vacancy in `draft` with live `pending` approvals attached.
      return runTenantTransaction(ctx.user.organizationId, async (tx) => {
        await tx.vacancyApproval.update({
          where: { id: approval.id },
          data: { status: 'rejected', comment: input.comment, decidedAt: new Date() },
        });

        await tx.vacancy.update({
          where: { id: input.id },
          data: { status: 'draft' },
        });

        await tx.vacancyApproval.updateMany({
          where: { vacancyId: input.id, status: 'pending' },
          data: { status: 'cancelled' },
        });

        return tx.vacancy.findUniqueOrThrow({
          where: { id: input.id },
          select: vacancyWithApprovalsSelect,
        });
      });
    }),

  getApprovalChain: permissionProcedure('vacancy', 'read')
    .input(z.object({ vacancyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('vacancy', ctx.access, ctx.user.id);
      const vacancy = await db.vacancy.findFirst({
        where: {
          AND: [
            { id: input.vacancyId, organizationId: ctx.user.organizationId, deletedAt: null },
            scopeWhere as Prisma.VacancyWhereInput,
          ],
        },
        select: { id: true },
      });
      if (!vacancy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });
      }

      return db.vacancyApproval.findMany({
        where: { vacancyId: input.vacancyId },
        orderBy: { step: 'asc' },
        select: approvalSelect,
      });
    }),
});
