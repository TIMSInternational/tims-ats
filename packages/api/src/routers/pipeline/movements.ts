import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { pipelineService } from '../../services/pipeline.service';
import type { Prisma } from '@tims/db';
import { assertScoped, scopeWhereFor } from '../../access';

export const pipelineMovementsRouter = router({
  // Probe the parent vacancy so a narrow-scoped user cannot read board data
  // for an out-of-scope vacancy by guessing its id. All applications on this
  // board belong to a single vacancy; the single-id vacancy gate covers them
  // (same justification as vacancy stats.ts getStats).
  getBoard: permissionProcedure('pipeline', 'read')
    .input(z.object({
      vacancyId: z.string().uuid(),
      status: z.enum(['active', 'rejected', 'all']).default('active'),
    }))
    .query(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.getBoard(ctx.user.organizationId, input.vacancyId, input.status);
    }),

  moveCandidate: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationId: z.string().uuid(),
      toStageId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.moveCandidate(ctx.user.organizationId, ctx.user.id, input.applicationId, input.toStageId, input.reason);
    }),

  // Count-check pattern (application has no deletedAt — no soft-delete guard needed).
  // Dedup ids in the router, compute scope fragment, pass both through to service.
  bulkMove: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationIds: z.array(z.string().uuid()).min(1).max(50),
      toStageId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const uniqueIds = [...new Set(input.applicationIds)];
      const scopeWhere = await scopeWhereFor('application', ctx.access, ctx.user.id) as Prisma.ApplicationWhereInput;
      return pipelineService.bulkMove(ctx.user.organizationId, ctx.user.id, uniqueIds, input.toStageId, scopeWhere, input.reason);
    }),

  rejectCandidate: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationId: z.string().uuid(),
      reason: z.string().min(1).max(500),
      feedback: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.rejectCandidate(ctx.user.organizationId, input.applicationId, input.reason, input.feedback);
    }),

  getMovementHistory: permissionProcedure('pipeline', 'read')
    .input(z.object({ applicationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.getMovementHistory(ctx.user.organizationId, input.applicationId);
    }),

  // Per-application checklist item toggle — powers the checkboxes on the
  // candidate's stage card. stageId is normally the application's CURRENT
  // stage (the frontend only renders checkboxes for the current stage's
  // checklist), but the mutation itself is stage-agnostic: it just upserts
  // one entry under checklistProgress[stageId][itemKey].
  updateApplicationChecklist: permissionProcedure('pipeline', 'update')
    .input(z.object({
      applicationId: z.string().uuid(),
      stageId: z.string().uuid(),
      itemKey: z.string().max(100),
      completed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return pipelineService.updateApplicationChecklist(
        ctx.user.organizationId,
        ctx.user.id,
        input.applicationId,
        input.stageId,
        input.itemKey,
        input.completed,
      );
    }),
});
