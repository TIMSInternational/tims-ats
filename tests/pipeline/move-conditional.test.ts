import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stage move (single or bulk) must only move applications that are still active. A stale board drag
// after a hire (or a rejection) must neither move the application out of the hired stage nor leave a
// movement row behind: the conditional update runs first and a mismatch rolls the transaction back.

const tx = vi.hoisted(() => ({
  application: { updateMany: vi.fn(), findFirst: vi.fn() },
  stageMovement: { create: vi.fn(), createMany: vi.fn() },
}));
vi.mock('@tims/db', () => ({
  tenantDb: {},
  runTenantTransaction: async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
}));

import { ApplicationNotActiveError, pipelineRepository } from '../../packages/api/src/repositories/pipeline.repository';

const ORG = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  tx.application.findFirst.mockResolvedValue({ id: 'app-1' });
});

describe('pipelineRepository.moveCandidate', () => {
  it('moves only an active application, then records the movement', async () => {
    tx.application.updateMany.mockResolvedValue({ count: 1 });
    await pipelineRepository.moveCandidate(ORG, 'u1', 'app-1', 's1', 's2');
    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: { id: 'app-1', organizationId: ORG, status: 'active' },
      data: { currentStageId: 's2' },
    });
    expect(tx.stageMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.application.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.stageMovement.create.mock.invocationCallOrder[0]!,
    );
  });

  it('refuses (and writes no movement) when the application is no longer active', async () => {
    tx.application.updateMany.mockResolvedValue({ count: 0 });
    await expect(pipelineRepository.moveCandidate(ORG, 'u1', 'app-1', 's1', 's2')).rejects.toBeInstanceOf(
      ApplicationNotActiveError,
    );
    expect(tx.stageMovement.create).not.toHaveBeenCalled();
  });
});

describe('pipelineRepository.bulkMove', () => {
  const apps = [
    { id: 'a1', currentStageId: 's1' },
    { id: 'a2', currentStageId: 's1' },
  ];

  it('moves only active applications', async () => {
    tx.application.updateMany.mockResolvedValue({ count: 2 });
    await expect(pipelineRepository.bulkMove(ORG, 'u1', apps, 's2')).resolves.toEqual({ moved: 2 });
    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, organizationId: ORG, status: 'active' },
      data: { currentStageId: 's2' },
    });
    expect(tx.stageMovement.createMany).toHaveBeenCalledTimes(1);
  });

  it('rolls back the whole bulk move when any application stopped being active', async () => {
    tx.application.updateMany.mockResolvedValue({ count: 1 });
    await expect(pipelineRepository.bulkMove(ORG, 'u1', apps, 's2')).rejects.toBeInstanceOf(ApplicationNotActiveError);
    expect(tx.stageMovement.createMany).not.toHaveBeenCalled();
  });
});
