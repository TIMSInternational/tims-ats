import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { pipelineService } from '../../services/pipeline.service';
import { rejectionEmailService } from '../../services/rejection-email.service';
import { runAfterResponse } from '../../lib/after-response';
import type { Prisma } from '@tims/db';
import { assertScoped, scopeWhereFor } from '../../access';
import { hidesBelowMinimum } from '@tims/ai';

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
      return pipelineService.getBoard(ctx.user.organizationId, input.vacancyId, input.status, hidesBelowMinimum(ctx.access.scope));
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
      // Opt-in, default OFF (C-11): one neutral email telling the candidate the process continued with
      // other profiles. It never carries the reason or the internal note.
      notifyCandidate: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.user.organizationId;
      await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, orgId);
      const rejected = await pipelineService.rejectCandidate(
        orgId,
        { userId: ctx.user.id, actorId: ctx.user.impersonatorId ?? ctx.user.id },
        input.applicationId,
        input.reason,
        input.feedback,
        input.notifyCandidate,
      );
      const candidateNotification = input.notifyCandidate
        ? await rejectionEmailService.notificationOutcome(orgId, rejected?.candidate.id ?? null)
        : ('not_requested' as const);
      if (candidateNotification === 'queued') {
        // After the response (lib/after-response.ts): a bare `void` send is frozen by the serverless runtime.
        runAfterResponse(ctx, () => rejectionEmailService.send(orgId, input.applicationId).then(() => undefined));
      }
      return { ...rejected, candidateNotification };
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
