import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tims/db', () => ({
  tenantDb: {
    application: { count: vi.fn() },
    stageMovement: { findMany: vi.fn() },
  },
}));

import { pipelineRepository } from '../../packages/api/src/repositories/pipeline.repository';
import { tenantDb } from '@tims/db';

beforeEach(() => vi.clearAllMocks());

describe('pipelineRepository.getFunnelCounts', () => {
  it('counts distinct applications, not raw movement rows returned by the query', async () => {
    vi.mocked(tenantDb.application.count).mockResolvedValue(5 as never);
    // Prisma applies `distinct: ['applicationId']` server-side, so a real
    // response here already has one row per application (e.g. app-1 was
    // bounced out and moved back into the stage, but only counts once).
    vi.mocked(tenantDb.stageMovement.findMany).mockResolvedValue(
      [{ applicationId: 'app-1' }, { applicationId: 'app-2' }] as never,
    );

    const [result] = await pipelineRepository.getFunnelCounts('vac-1', [
      { id: 'stage-1' },
    ]);

    expect(result.everReachedCount).toBe(2);
  });

  it('passes distinct applicationId selection to the movement query', async () => {
    vi.mocked(tenantDb.application.count).mockResolvedValue(0 as never);
    vi.mocked(tenantDb.stageMovement.findMany).mockResolvedValue([] as never);

    await pipelineRepository.getFunnelCounts('vac-1', [{ id: 'stage-1' }]);

    expect(tenantDb.stageMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { toStageId: 'stage-1', application: { vacancyId: 'vac-1' } },
        distinct: ['applicationId'],
        select: { applicationId: true },
      }),
    );
  });
});
