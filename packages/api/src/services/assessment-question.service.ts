import { TRPCError } from '@trpc/server';
import { validateQuestionCoherence } from '@tims/shared';
import type { CreateQuestionInput, UpdateQuestionInput } from '@tims/shared';
import { assessmentQuestionRepo } from '../repositories/assessment-question.repository';

// Cross-field coherence is the authoring invariant (type ↔ options ↔ correct ids).
// Surfaced to the client as a stable BAD_REQUEST code for i18n on the UI side.
function assertCoherent(input: {
  type: CreateQuestionInput['type'];
  options: CreateQuestionInput['options'];
  correctOptionIds: CreateQuestionInput['correctOptionIds'];
}) {
  const result = validateQuestionCoherence({
    type: input.type,
    options: input.options,
    correctOptionIds: input.correctOptionIds,
  });
  if (!result.valid) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: result.code });
  }
}

export const assessmentQuestionService = {
  async create(orgId: string, input: CreateQuestionInput) {
    assertCoherent(input);
    const type = await assessmentQuestionRepo.findTypeById(orgId, input.assessmentTypeId);
    if (!type) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assessment type not found' });

    return assessmentQuestionRepo.create({
      organizationId: orgId,
      assessmentTypeId: input.assessmentTypeId,
      order: input.order,
      type: input.type,
      prompt: input.prompt,
      options: input.options,
      correctOptionIds: input.correctOptionIds,
      points: input.points,
    });
  },

  async update(orgId: string, input: UpdateQuestionInput) {
    assertCoherent(input);
    const existing = await assessmentQuestionRepo.findQuestionById(orgId, input.id);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });

    return assessmentQuestionRepo.update(input.id, {
      order: input.order,
      type: input.type,
      prompt: input.prompt,
      options: input.options,
      correctOptionIds: input.correctOptionIds,
      points: input.points,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });
  },

  async remove(orgId: string, id: string) {
    const existing = await assessmentQuestionRepo.findQuestionById(orgId, id);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });

    // A question with submitted responses must be deactivated, not destroyed —
    // hard-deleting it would erase candidate answer history (the FK is RESTRICT,
    // so this also fails closed at the DB if this guard ever regresses).
    const responseCount = await assessmentQuestionRepo.countResponsesForQuestion(orgId, id);
    if (responseCount > 0) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'question_has_responses',
      });
    }

    await assessmentQuestionRepo.remove(id);
    return { id };
  },

  async list(orgId: string, args: { assessmentTypeId: string; includeInactive: boolean }) {
    const type = await assessmentQuestionRepo.findTypeById(orgId, args.assessmentTypeId);
    if (!type) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assessment type not found' });
    return assessmentQuestionRepo.list(orgId, args.assessmentTypeId, args.includeInactive);
  },
};
