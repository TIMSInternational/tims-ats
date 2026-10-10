import { describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn().mockResolvedValue([]) }));
vi.mock('@tims/db', () => ({
  tenantDb: { pipelineStage: { findMany } },
  runTenantTransaction: vi.fn(),
}));

// #312: withdrawn candidates' scores are hidden by an AND'd filter from the consent repository.
const HIDDEN = { candidateId: { notIn: ['withdrawn-1'] } };
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { visibleFitScoreWhere: vi.fn(async () => HIDDEN) },
}));

import { pipelineRepository } from '../../packages/api/src/repositories/pipeline.repository';

describe('pipeline board FIT scope', () => {
  it('selects only persisted FIT for the board vacancy and organization', async () => {
    await pipelineRepository.getBoard('org-1', 'vacancy-1', 'active');

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', vacancyId: 'vacancy-1' },
      select: expect.objectContaining({
        applications: expect.objectContaining({
          select: expect.objectContaining({
            candidate: expect.objectContaining({
              select: expect.objectContaining({
                fitScores: {
                  where: { organizationId: 'org-1', vacancyId: 'vacancy-1', AND: [HIDDEN] },
                  take: 1,
                  select: { overallScore: true, isPartial: true },
                },
              }),
            }),
          }),
        }),
      }),
    }));
  });
});
