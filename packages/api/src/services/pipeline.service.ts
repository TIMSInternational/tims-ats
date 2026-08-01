import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { pipelineRepository } from '../repositories/pipeline.repository';

// ---------------------------------------------------------------------------
// Pipeline Service — board/movement business logic, no db imports.
// Stage config lives in pipeline-stages.service.ts; analytics in
// pipeline-analytics.service.ts (split per CLAUDE.md's 300-line service cap).
// ---------------------------------------------------------------------------

// Shape of a PipelineStage.checklist entry (matches checklistItemSchema in
// routers/pipeline/stages.ts — `completed` there is just the item's config
// default, NOT per-application state, which lives separately below).
interface ChecklistItemConfig {
  key: string;
  label: string;
}

// Shape of Application.checklistProgress — per-application, per-stage
// completion state. Only stages the candidate has actually progressed
// through get an entry.
type ChecklistProgress = Record<
  string,
  Record<
    string,
    {
      completed: boolean;
      completedBy: string;
      completedAt: string;
    }
  >
>;

// Diffs a stage's configured checklist against this application's recorded
// progress for that SAME stage, returning the labels of items not yet marked
// complete. Returns [] when the stage has no checklist configured. Plain
// module-level helper (not a pipelineService method) so it never depends on
// `this` binding.
async function getIncompleteChecklistWarnings(
  orgId: string,
  stageId: string,
  checklistProgress: ChecklistProgress | null,
): Promise<string[]> {
  const stage = await pipelineRepository.getStageChecklist(orgId, stageId);
  const checklist = (stage?.checklist as ChecklistItemConfig[] | null) ?? [];
  if (checklist.length === 0) return [];

  const stageProgress = checklistProgress?.[stageId] ?? {};
  return checklist.filter((item) => !stageProgress[item.key]?.completed).map((item) => item.label);
}

export const pipelineService = {
  // Board
  async getBoard(orgId: string, vacancyId: string, status: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });

    const stages = await pipelineRepository.getBoard(orgId, vacancyId, status);

    return {
      vacancyId,
      stages: stages.map((stage) => ({
        ...stage,
        count: stage.applications.length,
        applications: stage.applications.map(({ movements, ...app }) => ({
          ...app,
          // Same derivation as getSlaStatus: time-in-CURRENT-stage, not time
          // since the original application — a card that's been in the
          // pipeline a long time but just moved into this stage isn't overdue.
          enteredStageAt: movements[0]?.movedAt ?? app.appliedAt,
        })),
      })),
    };
  },

  // Move — SOFT checklist gate: if the SOURCE stage (the one being left) has
  // an incomplete checklist, the move still proceeds and the result carries a
  // `warnings` array naming the incomplete items. Never throws for this —
  // configuring a checklist makes stage moves proactive (surfaced), not
  // blocking.
  async moveCandidate(orgId: string, userId: string, applicationId: string, toStageId: string, reason?: string) {
    const application = await pipelineRepository.findApplication(orgId, applicationId);
    if (!application) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });

    const targetStage = await pipelineRepository.stageExistsForVacancy(toStageId, application.vacancyId);
    if (!targetStage)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'La etapa destino no pertenece a esta vacante' });

    const warnings = await getIncompleteChecklistWarnings(
      orgId,
      application.currentStageId,
      application.checklistProgress as ChecklistProgress | null,
    );

    const moved = await pipelineRepository.moveCandidate(
      orgId,
      userId,
      applicationId,
      application.currentStageId,
      toStageId,
      reason,
    );
    // Always the same static shape (never a union across branches) so tRPC's
    // inferred router output type carries `warnings` as one stable optional
    // field instead of two incompatible object shapes.
    return { ...moved, warnings: warnings.length > 0 ? warnings : undefined };
  },

  // Bulk move — scopeWhere is computed in the router (access machinery is not
  // imported in services) and is REQUIRED: a defaulted fragment would fail open.
  async bulkMove(
    orgId: string,
    userId: string,
    applicationIds: string[],
    toStageId: string,
    scopeWhere: Prisma.ApplicationWhereInput,
    reason?: string,
  ) {
    const uniqueIds = [...new Set(applicationIds)];
    const inScopeCount = await pipelineRepository.countApplicationsInScope(orgId, uniqueIds, scopeWhere);
    if (inScopeCount !== uniqueIds.length) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
    }

    const applications = await pipelineRepository.findApplications(orgId, uniqueIds);
    if (applications.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicaciones no encontradas' });

    const vacancyIds = [...new Set(applications.map((a) => a.vacancyId))];
    if (vacancyIds.length > 1)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Todas las aplicaciones deben pertenecer a la misma vacante',
      });

    const targetStage = await pipelineRepository.stageExistsForVacancy(toStageId, vacancyIds[0]);
    if (!targetStage)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'La etapa destino no pertenece a esta vacante' });

    return pipelineRepository.bulkMove(orgId, userId, applications, toStageId, reason);
  },

  // Reject
  async rejectCandidate(orgId: string, applicationId: string, reason: string, feedback?: string) {
    const application = await pipelineRepository.findApplication(orgId, applicationId);
    if (!application || application.status !== 'active') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada o ya fue rechazada' });
    }
    return pipelineRepository.rejectApplication(applicationId, reason, feedback);
  },

  // Movement history
  async getMovementHistory(orgId: string, applicationId: string) {
    const application = await pipelineRepository.findApplication(orgId, applicationId);
    if (!application) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
    return pipelineRepository.getMovementHistory(applicationId);
  },

  // Per-application checklist item toggle. SINGLE atomic UPDATE (Postgres
  // jsonb_set) — no read-merge-write. Only the [stageId][itemKey] entry is
  // touched at the DB level, so two toggles for DIFFERENT items on the SAME
  // application firing concurrently (two tabs/users) both survive instead of
  // one silently clobbering the other (see setChecklistItem in the repository
  // for why a plain $transaction around a read-then-write would NOT have
  // fixed this). The org check is folded into the UPDATE's WHERE clause
  // (no separate findApplication read) — a null result means the
  // application doesn't exist or doesn't belong to this org.
  async updateApplicationChecklist(
    orgId: string,
    userId: string,
    applicationId: string,
    stageId: string,
    itemKey: string,
    completed: boolean,
  ) {
    const entry = { completed, completedBy: userId, completedAt: new Date().toISOString() };
    const updated = await pipelineRepository.setChecklistItem(orgId, applicationId, stageId, itemKey, entry);
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });
    return updated;
  },
};
