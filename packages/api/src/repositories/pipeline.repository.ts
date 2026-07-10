import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';

// ---------------------------------------------------------------------------
// Explicit select objects
// ---------------------------------------------------------------------------

const boardApplicationSelect = {
  id: true,
  status: true,
  source: true,
  appliedAt: true,
  checklistProgress: true,
  movements: {
    orderBy: { movedAt: 'desc' as const },
    take: 1,
    select: { movedAt: true },
  },
  candidate: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      currentTitle: true,
      currentCompany: true,
    },
  },
} satisfies Prisma.ApplicationSelect;

const stageSelect = {
  id: true,
  name: true,
  order: true,
  slaHours: true,
  checklist: true,
  isDefault: true,
} satisfies Prisma.PipelineStageSelect;

const stageMutationSelect = {
  id: true,
  name: true,
  order: true,
  slaHours: true,
  isDefault: true,
} satisfies Prisma.PipelineStageSelect;

const applicationMutationSelect = {
  id: true,
  status: true,
  appliedAt: true,
  candidate: {
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  },
  currentStage: { select: { id: true, name: true, order: true } },
} satisfies Prisma.ApplicationSelect;

const movementSelect = {
  id: true,
  movedAt: true,
  reason: true,
  fromStage: { select: { id: true, name: true, order: true } },
  toStage: { select: { id: true, name: true, order: true } },
  actor: { select: { id: true, firstName: true, lastName: true, avatar: true } },
} satisfies Prisma.StageMovementSelect;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const pipelineRepository = {
  // Board
  async getBoard(orgId: string, vacancyId: string, statusFilter: string) {
    const applicationWhere: Prisma.ApplicationWhereInput = {
      vacancyId,
      organizationId: orgId,
    };
    if (statusFilter !== 'all') {
      applicationWhere.status = statusFilter;
    }

    return db.pipelineStage.findMany({
      where: { vacancyId, organizationId: orgId },
      orderBy: { order: 'asc' },
      select: {
        ...stageSelect,
        applications: {
          where: applicationWhere,
          orderBy: { appliedAt: 'desc' as const },
          select: boardApplicationSelect,
        },
      },
    });
  },

  // Vacancy existence check
  async vacancyExists(orgId: string, vacancyId: string) {
    return db.vacancy.findFirst({
      where: { id: vacancyId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
  },

  // Application lookup
  async findApplication(orgId: string, applicationId: string) {
    return db.application.findFirst({
      where: { id: applicationId, organizationId: orgId },
      select: { id: true, vacancyId: true, currentStageId: true, status: true, checklistProgress: true },
    });
  },

  async findApplications(orgId: string, applicationIds: string[]) {
    return db.application.findMany({
      where: { id: { in: applicationIds }, organizationId: orgId },
      select: { id: true, vacancyId: true, currentStageId: true },
    });
  },

  // Scope-count for bulkMove: counts only the ids that are in-scope.
  // Applications have no deletedAt column (design fact — no soft-delete guard needed).
  async countApplicationsInScope(orgId: string, applicationIds: string[], scopeWhere: Prisma.ApplicationWhereInput) {
    return db.application.count({
      where: {
        AND: [
          { id: { in: applicationIds }, organizationId: orgId },
          scopeWhere,
        ],
      },
    });
  },

  // Stage lookup
  async findStage(orgId: string, stageId: string) {
    return db.pipelineStage.findFirst({
      where: { id: stageId, organizationId: orgId },
      select: { id: true, vacancyId: true },
    });
  },

  async stageExistsForVacancy(stageId: string, vacancyId: string) {
    return db.pipelineStage.findFirst({
      where: { id: stageId, vacancyId },
      select: { id: true },
    });
  },

  // Move candidate (transaction)
  async moveCandidate(
    orgId: string,
    userId: string,
    applicationId: string,
    fromStageId: string,
    toStageId: string,
    reason?: string,
  ) {
    return db.$transaction(async (tx) => {
      await tx.stageMovement.create({
        data: {
          organizationId: orgId,
          applicationId,
          fromStageId,
          toStageId,
          movedBy: userId,
          reason,
        },
      });

      return tx.application.update({
        where: { id: applicationId },
        data: { currentStageId: toStageId },
        select: applicationMutationSelect,
      });
    });
  },

  // Bulk move (transaction)
  async bulkMove(
    orgId: string,
    userId: string,
    applications: Array<{ id: string; currentStageId: string }>,
    toStageId: string,
    reason?: string,
  ) {
    return db.$transaction(async (tx) => {
      await tx.stageMovement.createMany({
        data: applications.map((app) => ({
          organizationId: orgId,
          applicationId: app.id,
          fromStageId: app.currentStageId,
          toStageId,
          movedBy: userId,
          reason,
        })),
      });

      await tx.application.updateMany({
        where: { id: { in: applications.map((a) => a.id) } },
        data: { currentStageId: toStageId },
      });

      return { moved: applications.length };
    });
  },

  // Reject
  async rejectApplication(applicationId: string, reason: string, feedback?: string) {
    return db.application.update({
      where: { id: applicationId },
      data: {
        status: 'rejected',
        rejectedAt: new Date(),
        rejectedReason: reason,
        feedback,
      },
      select: applicationMutationSelect,
    });
  },

  // Movement history
  async getMovementHistory(applicationId: string) {
    return db.stageMovement.findMany({
      where: { applicationId },
      orderBy: { movedAt: 'asc' },
      select: movementSelect,
    });
  },

  // Stages CRUD
  async listStages(orgId: string, vacancyId: string) {
    return db.pipelineStage.findMany({
      where: { vacancyId, organizationId: orgId },
      orderBy: { order: 'asc' },
      select: {
        ...stageSelect,
        _count: { select: { applications: true } },
      },
    });
  },

  async createStage(orgId: string, data: {
    vacancyId: string; name: string; order: number;
    slaHours?: number; checklist?: unknown; isDefault: boolean;
  }) {
    return db.pipelineStage.create({
      data: {
        organizationId: orgId,
        vacancyId: data.vacancyId,
        name: data.name,
        order: data.order,
        slaHours: data.slaHours,
        checklist: data.checklist as Prisma.InputJsonValue ?? undefined,
        isDefault: data.isDefault,
      },
      select: stageMutationSelect,
    });
  },

  async updateStage(stageId: string, data: Record<string, unknown>) {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.order !== undefined) updateData.order = data.order;
    if (data.slaHours !== undefined) updateData.slaHours = data.slaHours;
    if (data.checklist !== undefined) updateData.checklist = data.checklist as Prisma.InputJsonValue;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    return db.pipelineStage.update({
      where: { id: stageId },
      data: updateData as Prisma.PipelineStageUpdateInput,
      select: stageMutationSelect,
    });
  },

  async getStageWithApplicationCount(orgId: string, stageId: string) {
    return db.pipelineStage.findFirst({
      where: { id: stageId, organizationId: orgId },
      select: { id: true, _count: { select: { applications: true } } },
    });
  },

  async deleteStage(stageId: string) {
    await db.pipelineStage.delete({ where: { id: stageId } });
  },

  async getStageChecklist(orgId: string, stageId: string) {
    return db.pipelineStage.findFirst({
      where: { id: stageId, organizationId: orgId },
      select: { id: true, name: true, checklist: true },
    });
  },

  async updateChecklist(stageId: string, checklist: unknown) {
    return db.pipelineStage.update({
      where: { id: stageId },
      data: { checklist: checklist as Prisma.InputJsonValue },
      select: { id: true, name: true, checklist: true },
    });
  },

  // Per-application checklist-item toggle — SINGLE atomic UPDATE, no
  // read-then-write. Two toggles for DIFFERENT items on the SAME application
  // firing concurrently (two tabs/users) must both survive: a read-merge-write
  // (read full JSON map, mutate in JS, write the full map back) would let
  // whichever write commits last silently clobber the other's item under
  // Postgres's default READ COMMITTED isolation — wrapping that same
  // read-then-write in $transaction would NOT fix it either, since both
  // transactions could still each read the pre-update state before either
  // commits. Postgres resolves this correctly at the row level: this UPDATE
  // never reads application-side state into the app at all — `jsonb_set`
  // computes the new value FROM THE ROW BEING UPDATED, so Postgres's own
  // row-level write lock serializes the two concurrent UPDATEs (second one
  // blocks until the first commits, then applies jsonb_set against the
  // ALREADY-updated value) — accumulation instead of a lost update.
  //
  // jsonb_set with a multi-level path ({stageId, itemKey}) does NOT create a
  // missing intermediate key — if `stageId` isn't already a top-level key,
  // create_missing on the multi-level call is a no-op. So this nests two
  // single-level jsonb_set calls: the INNER one builds the stage's item map
  // (keyed by itemKey, starting from the stage's existing sub-object or {}),
  // the OUTER one sets that whole sub-object back onto the top-level map
  // keyed by stageId (where stageId IS the last path element, so
  // create_missing correctly creates it when absent).
  //
  // orgId is part of the WHERE clause (not a separate findApplication read)
  // — this doubles as the tenant-ownership check: 0 rows back means either
  // the application doesn't exist or doesn't belong to this org.
  async setChecklistItem(
    orgId: string,
    applicationId: string,
    stageId: string,
    itemKey: string,
    entry: { completed: boolean; completedBy: string; completedAt: string },
  ) {
    const rows = await db.$queryRaw<Array<{ id: string; currentStageId: string; checklistProgress: unknown }>>`
      UPDATE applications
      SET checklist_progress = jsonb_set(
        COALESCE(checklist_progress, '{}'::jsonb),
        ARRAY[${stageId}]::text[],
        jsonb_set(
          COALESCE(checklist_progress -> ${stageId}, '{}'::jsonb),
          ARRAY[${itemKey}]::text[],
          ${JSON.stringify(entry)}::jsonb,
          true
        ),
        true
      )
      WHERE id = ${applicationId}::uuid AND organization_id = ${orgId}::uuid
      RETURNING id, current_stage_id AS "currentStageId", checklist_progress AS "checklistProgress"
    `;
    return rows[0] ?? null;
  },

  // Analytics — org-wide (across vacancies), used by the dashboard KPI strip.
  // Kept separate from getActiveApplicationsWithMovements (single-vacancy) so
  // callers can't accidentally drop the org/scope filter on a cross-org query.
  async getActiveApplicationsForOrgSla(orgId: string, appScopeWhere: Prisma.ApplicationWhereInput) {
    return db.application.findMany({
      where: { AND: [{ organizationId: orgId, status: 'active' }, appScopeWhere] },
      select: {
        id: true,
        appliedAt: true,
        currentStage: { select: { slaHours: true } },
        movements: {
          orderBy: { movedAt: 'desc' as const },
          take: 1,
          select: { movedAt: true },
        },
      },
    });
  },

  // Analytics
  async getActiveApplicationsWithMovements(vacancyId: string) {
    return db.application.findMany({
      where: { vacancyId, status: 'active' },
      select: {
        id: true,
        currentStageId: true,
        appliedAt: true,
        candidate: { select: { id: true, firstName: true, lastName: true } },
        movements: {
          orderBy: { movedAt: 'desc' as const },
          take: 1,
          select: { movedAt: true },
        },
      },
    });
  },

  async getStagesForVacancy(vacancyId: string) {
    return db.pipelineStage.findMany({
      where: { vacancyId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, order: true, slaHours: true },
    });
  },

  async getApplicationForAction(orgId: string, applicationId: string) {
    return db.application.findFirst({
      where: { id: applicationId, organizationId: orgId },
      select: {
        id: true,
        candidate: { select: { id: true, firstName: true, lastName: true } },
        currentStage: { select: { id: true, name: true, order: true } },
      },
    });
  },

  async getFunnelCounts(vacancyId: string, stages: Array<{ id: string }>) {
    return Promise.all(
      stages.map(async (stage) => {
        const [currentCount, everReachedRows] = await Promise.all([
          db.application.count({
            where: { vacancyId, currentStageId: stage.id, status: 'active' },
          }),
          // Distinct applicationId — an application bounced out and later
          // reconsidered into the same stage produces multiple StageMovement
          // rows, which would otherwise inflate this above the true headcount
          // and push downstream conversion rates over 100%.
          db.stageMovement.findMany({
            where: { toStageId: stage.id, application: { vacancyId } },
            distinct: ['applicationId'],
            select: { applicationId: true },
          }),
        ]);
        return { stageId: stage.id, currentCount, everReachedCount: everReachedRows.length };
      }),
    );
  },

  async getApplicationCounts(vacancyId: string) {
    const [total, rejected] = await Promise.all([
      db.application.count({ where: { vacancyId } }),
      db.application.count({ where: { vacancyId, status: 'rejected' } }),
    ]);
    return { total, rejected };
  },
};
