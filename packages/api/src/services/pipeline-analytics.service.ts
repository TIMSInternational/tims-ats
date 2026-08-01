import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { suggestNextBestAction } from '@tims/ai';
import { pipelineRepository } from '../repositories/pipeline.repository';

// ---------------------------------------------------------------------------
// Pipeline Analytics Service — SLA/funnel/next-best-action, no db imports.
// Split from pipeline.service.ts (CLAUDE.md 300-line service cap).
// ---------------------------------------------------------------------------

export const pipelineAnalyticsService = {
  // Org-wide SLA-overdue count (dashboard KPI strip). scopeWhere is computed
  // in the router (access machinery is not imported in services) and is
  // REQUIRED: a defaulted fragment would fail open, same as bulkMove in
  // pipeline.service.ts.
  async getOrgSlaOverdueCount(orgId: string, appScopeWhere: Prisma.ApplicationWhereInput) {
    const applications = await pipelineRepository.getActiveApplicationsForOrgSla(orgId, appScopeWhere);
    const now = Date.now();

    return applications.filter((app) => {
      const slaHours = app.currentStage.slaHours;
      if (slaHours == null) return false;
      const enteredStageAt = app.movements[0]?.movedAt ?? app.appliedAt;
      const hoursInStage = (now - enteredStageAt.getTime()) / (1000 * 60 * 60);
      return hoursInStage > slaHours;
    }).length;
  },

  async getSlaStatus(orgId: string, vacancyId: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });

    const stages = await pipelineRepository.getStagesForVacancy(vacancyId);
    const applications = await pipelineRepository.getActiveApplicationsWithMovements(vacancyId);
    const now = new Date();

    const items = applications.map((app) => {
      const stage = stages.find((s) => s.id === app.currentStageId);
      const enteredStageAt = app.movements[0]?.movedAt ?? app.appliedAt;
      // hoursInStage is floored for display (e.g. "8h in stage"); isOverdue
      // must compare against the PRECISE elapsed time so a sub-hour SLA
      // breach (e.g. 8.5h against an 8h SLA) is caught immediately instead
      // of only after the floored value ticks over to a full extra hour.
      const preciseHoursInStage = (now.getTime() - enteredStageAt.getTime()) / (1000 * 60 * 60);
      const hoursInStage = Math.floor(preciseHoursInStage);
      const isOverdue = stage?.slaHours != null && preciseHoursInStage > stage.slaHours;

      return {
        applicationId: app.id,
        candidateId: app.candidate.id,
        candidateName: `${app.candidate.firstName} ${app.candidate.lastName}`,
        stageId: app.currentStageId,
        stageName: stage?.name ?? 'Desconocida',
        enteredStageAt,
        hoursInStage,
        slaHours: stage?.slaHours ?? null,
        isOverdue,
      };
    });

    return {
      vacancyId,
      totalActive: items.length,
      overdueCount: items.filter((s) => s.isOverdue).length,
      items,
    };
  },

  // Next best action (Bedrock-backed via the 'pipeline-optimizer' agent).
  async getNextBestAction(orgId: string, applicationId: string) {
    const app = await pipelineRepository.getApplicationForAction(orgId, applicationId);
    if (!app) throw new TRPCError({ code: 'NOT_FOUND', message: 'Aplicacion no encontrada' });

    const candidateName = `${app.candidate.firstName} ${app.candidate.lastName}`;
    const { result, model } = await suggestNextBestAction(orgId, {
      candidateName,
      currentStageName: app.currentStage.name,
      currentStageOrder: app.currentStage.order,
    });

    return {
      applicationId,
      candidateName,
      currentStage: app.currentStage.name,
      recommendation: result.recommendation,
      confidence: result.confidence,
      suggestedActions: result.suggestedActions,
      model,
    };
  },

  async getFunnel(orgId: string, vacancyId: string) {
    const vacancy = await pipelineRepository.vacancyExists(orgId, vacancyId);
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });

    const stages = await pipelineRepository.getStagesForVacancy(vacancyId);
    const funnelCounts = await pipelineRepository.getFunnelCounts(vacancyId, stages);
    const { total: totalApplications, rejected: rejectedCount } =
      await pipelineRepository.getApplicationCounts(vacancyId);

    const funnel = stages.map((stage, idx) => {
      const counts = funnelCounts.find((f) => f.stageId === stage.id);
      const prevCount = idx === 0 ? totalApplications : (funnelCounts[idx - 1]?.everReachedCount ?? 0);
      const everReached = counts?.everReachedCount ?? 0;
      const conversionRate = prevCount > 0 ? Math.round((everReached / prevCount) * 100) : 0;

      return {
        stageId: stage.id,
        stageName: stage.name,
        order: stage.order,
        currentCount: counts?.currentCount ?? 0,
        everReachedCount: everReached,
        conversionRate,
      };
    });

    return { vacancyId, totalApplications, rejectedCount, funnel };
  },
};
