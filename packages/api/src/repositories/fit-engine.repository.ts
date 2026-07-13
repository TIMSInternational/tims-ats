import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';

// ---------------------------------------------------------------------------
// FIT Engine repository — reads/writes for deterministic candidate<->vacancy
// fit scoring. Explicit selects only — never return full records.
// ---------------------------------------------------------------------------

export const fitEngineRepository = {
  async getCandidateForFit(orgId: string, candidateId: string) {
    return db.candidate.findFirst({
      where: { id: candidateId, organizationId: orgId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, yearsExperience: true, education: true, languages: true },
    });
  },

  async getVacancyForFit(orgId: string, vacancyId: string) {
    return db.vacancy.findFirst({
      where: { id: vacancyId, organizationId: orgId, deletedAt: null },
      // fitRequirements is the FIT Engine's own structured requirements field
      // (Codex-review fix) — distinct from JobProfile.requirements, the
      // free-text HR checklist array edited via vacancy.updateJobProfile,
      // which parseRequirements() cannot and should not parse.
      select: { id: true, roleFamily: true, jobProfile: { select: { fitRequirements: true } } },
    });
  },

  /** Latest normalizedScore from a completed AssessmentAssignment for this candidate+vacancy, if any. */
  async getLatestAssessmentScore(orgId: string, candidateId: string, vacancyId: string) {
    const assignment = await db.assessmentAssignment.findFirst({
      where: { organizationId: orgId, candidateId, vacancyId, result: { isNot: null } },
      orderBy: { completedAt: 'desc' },
      select: { result: { select: { normalizedScore: true } } },
    });
    return assignment?.result?.normalizedScore ?? null;
  },

  /** Latest AiInterviewSession.fitScore for this candidate+vacancy, if any. */
  async getLatestInterviewFitScore(orgId: string, candidateId: string, vacancyId: string) {
    const session = await db.aiInterviewSession.findFirst({
      where: { organizationId: orgId, candidateId, vacancyId, fitScore: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { fitScore: true },
    });
    return session?.fitScore ?? null;
  },

  async findWeightProfile(orgId: string, name: string) {
    return db.roleFamilyWeightProfile.findUnique({
      where: { organizationId_name: { organizationId: orgId, name } },
      select: { id: true, name: true, weights: true },
    });
  },

  async upsertWeightProfile(orgId: string, name: string, weights: Prisma.InputJsonValue) {
    return db.roleFamilyWeightProfile.upsert({
      where: { organizationId_name: { organizationId: orgId, name } },
      update: { weights },
      create: { organizationId: orgId, name, weights },
      select: { id: true, name: true, weights: true },
    });
  },

  async listWeightProfiles(orgId: string) {
    return db.roleFamilyWeightProfile.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, weights: true },
    });
  },

  async upsertFitScore(
    orgId: string,
    candidateId: string,
    vacancyId: string,
    overallScore: number,
    breakdown: Prisma.InputJsonValue,
    weights: Prisma.InputJsonValue,
    isPartial: boolean,
  ) {
    return db.fitScore.upsert({
      where: { candidateId_vacancyId: { candidateId, vacancyId } },
      update: { overallScore, breakdown, weights, isPartial, calculatedAt: new Date() },
      create: { organizationId: orgId, candidateId, vacancyId, overallScore, breakdown, weights, isPartial },
      select: { id: true, overallScore: true, breakdown: true, weights: true, isPartial: true },
    });
  },

  async getFitScoresForVacancy(orgId: string, vacancyId: string) {
    return db.fitScore.findMany({
      where: { organizationId: orgId, vacancyId },
      orderBy: { overallScore: 'desc' },
      select: {
        id: true,
        overallScore: true,
        breakdown: true,
        isPartial: true,
        calculatedAt: true,
        candidate: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  },

  async getFitScoreForExplain(orgId: string, candidateId: string, vacancyId: string) {
    return db.fitScore.findFirst({
      where: { candidateId, vacancyId, organizationId: orgId },
      select: {
        overallScore: true,
        breakdown: true,
        candidate: { select: { firstName: true, lastName: true } },
        vacancy: { select: { title: true } },
      },
    });
  },

  /** Distinct active candidate ids currently in this vacancy's pipeline. */
  async getPipelineCandidateIds(orgId: string, vacancyId: string) {
    const applications = await db.application.findMany({
      where: { organizationId: orgId, vacancyId, status: 'active' },
      select: { candidateId: true },
    });
    return applications.map((a) => a.candidateId);
  },
};
