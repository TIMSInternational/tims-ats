import { tenantDb } from '@tims/db';
import type { Prisma } from '@tims/db';

// Staff authoring view — includes correctOptionIds (staff may see/edit the key).
// Candidate-facing DTOs (Wave 1.5a slice 2) must NEVER select correctOptionIds.
const questionSelect = {
  id: true,
  assessmentTypeId: true,
  order: true,
  type: true,
  prompt: true,
  options: true,
  correctOptionIds: true,
  points: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssessmentQuestionSelect;

export const assessmentQuestionRepo = {
  // Ownership probes — tenantDb + explicit organizationId filter (defense in depth alongside RLS).
  findTypeById(orgId: string, id: string) {
    return tenantDb.assessmentType.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
  },

  findQuestionById(orgId: string, id: string) {
    return tenantDb.assessmentQuestion.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
  },

  countResponsesForQuestion(orgId: string, questionId: string) {
    return tenantDb.assessmentResponse.count({
      where: { questionId, organizationId: orgId },
    });
  },

  list(orgId: string, assessmentTypeId: string, includeInactive: boolean) {
    return tenantDb.assessmentQuestion.findMany({
      where: {
        organizationId: orgId,
        assessmentTypeId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { order: 'asc' },
      select: questionSelect,
    });
  },

  create(data: Prisma.AssessmentQuestionUncheckedCreateInput) {
    return tenantDb.assessmentQuestion.create({ data, select: questionSelect });
  },

  update(id: string, data: Prisma.AssessmentQuestionUncheckedUpdateInput) {
    return tenantDb.assessmentQuestion.update({ where: { id }, data, select: questionSelect });
  },

  remove(id: string) {
    return tenantDb.assessmentQuestion.delete({ where: { id }, select: { id: true } });
  },
};
