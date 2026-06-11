import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/assessment-question.repository', () => ({
  assessmentQuestionRepo: {
    findTypeById: vi.fn(),
    findQuestionById: vi.fn(),
    countResponsesForQuestion: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

import { assessmentQuestionService } from '../../packages/api/src/services/assessment-question.service';
import { assessmentQuestionRepo } from '../../packages/api/src/repositories/assessment-question.repository';

const ORG = 'org-1';
const TYPE_ID = '11111111-1111-1111-1111-111111111111';

const validSingle = {
  assessmentTypeId: TYPE_ID,
  type: 'single_choice' as const,
  prompt: 'What is 2+2?',
  options: [
    { id: 'a', label: '3' },
    { id: 'b', label: '4' },
  ],
  correctOptionIds: ['b'],
  points: 1,
  order: 0,
};

beforeEach(() => vi.clearAllMocks());

describe('assessmentQuestionService.create', () => {
  it('rejects an incoherent question before touching the DB', async () => {
    await expect(
      assessmentQuestionService.create(ORG, {
        ...validSingle,
        type: 'free_text',
        options: [{ id: 'a', label: 'A' }],
        correctOptionIds: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(assessmentQuestionRepo.findTypeById).not.toHaveBeenCalled();
    expect(assessmentQuestionRepo.create).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the assessment type is not in the org', async () => {
    vi.mocked(assessmentQuestionRepo.findTypeById).mockResolvedValue(null as never);
    await expect(assessmentQuestionService.create(ORG, validSingle)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(assessmentQuestionRepo.create).not.toHaveBeenCalled();
  });

  it('creates a coherent question scoped to the org', async () => {
    vi.mocked(assessmentQuestionRepo.findTypeById).mockResolvedValue({ id: TYPE_ID } as never);
    vi.mocked(assessmentQuestionRepo.create).mockResolvedValue({ id: 'q1' } as never);

    const r = await assessmentQuestionService.create(ORG, validSingle);

    expect(r).toEqual({ id: 'q1' });
    expect(assessmentQuestionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        assessmentTypeId: TYPE_ID,
        type: 'single_choice',
        correctOptionIds: ['b'],
      }),
    );
  });
});

describe('assessmentQuestionService.update', () => {
  it('rejects an incoherent update before touching the DB', async () => {
    await expect(
      assessmentQuestionService.update(ORG, {
        ...validSingle,
        id: '22222222-2222-2222-2222-222222222222',
        correctOptionIds: ['a', 'b'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(assessmentQuestionRepo.findQuestionById).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the question is not in the org', async () => {
    vi.mocked(assessmentQuestionRepo.findQuestionById).mockResolvedValue(null as never);
    await expect(
      assessmentQuestionService.update(ORG, {
        ...validSingle,
        id: '22222222-2222-2222-2222-222222222222',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(assessmentQuestionRepo.update).not.toHaveBeenCalled();
  });
});

describe('assessmentQuestionService.remove', () => {
  it('throws NOT_FOUND when the question is not in the org', async () => {
    vi.mocked(assessmentQuestionRepo.findQuestionById).mockResolvedValue(null as never);
    await expect(assessmentQuestionService.remove(ORG, 'q-uuid')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(assessmentQuestionRepo.remove).not.toHaveBeenCalled();
  });

  it('refuses to hard-delete a question that already has responses', async () => {
    vi.mocked(assessmentQuestionRepo.findQuestionById).mockResolvedValue({ id: 'q1' } as never);
    vi.mocked(assessmentQuestionRepo.countResponsesForQuestion).mockResolvedValue(3 as never);
    await expect(assessmentQuestionService.remove(ORG, 'q1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(assessmentQuestionRepo.remove).not.toHaveBeenCalled();
  });

  it('deletes a question that belongs to the org and has no responses', async () => {
    vi.mocked(assessmentQuestionRepo.findQuestionById).mockResolvedValue({ id: 'q1' } as never);
    vi.mocked(assessmentQuestionRepo.countResponsesForQuestion).mockResolvedValue(0 as never);
    vi.mocked(assessmentQuestionRepo.remove).mockResolvedValue({ id: 'q1' } as never);
    expect(await assessmentQuestionService.remove(ORG, 'q1')).toEqual({ id: 'q1' });
  });
});

describe('assessmentQuestionService.list', () => {
  it('throws NOT_FOUND when the type is not in the org', async () => {
    vi.mocked(assessmentQuestionRepo.findTypeById).mockResolvedValue(null as never);
    await expect(
      assessmentQuestionService.list(ORG, { assessmentTypeId: TYPE_ID, includeInactive: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns questions for a type that belongs to the org', async () => {
    vi.mocked(assessmentQuestionRepo.findTypeById).mockResolvedValue({ id: TYPE_ID } as never);
    vi.mocked(assessmentQuestionRepo.list).mockResolvedValue([{ id: 'q1' }] as never);
    expect(
      await assessmentQuestionService.list(ORG, { assessmentTypeId: TYPE_ID, includeInactive: false }),
    ).toEqual([{ id: 'q1' }]);
  });
});
