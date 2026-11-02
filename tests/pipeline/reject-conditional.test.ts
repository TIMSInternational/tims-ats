import { describe, expect, it, vi, beforeEach } from 'vitest';

// A rejection must only transition a STILL-active application, so it can never overwrite a hire (or a
// second rejection) that committed after the caller's status read.

const m = vi.hoisted(() => ({ updateMany: vi.fn(), findFirst: vi.fn() }));
vi.mock('@tims/db', () => ({
  tenantDb: { application: { updateMany: m.updateMany, findFirst: m.findFirst } },
  runWithTenant: (_o: string, fn: () => unknown) => fn(),
  runTenantTransaction: vi.fn(),
}));

const APP = '33333333-3333-4333-8333-333333333333';

describe('pipelineRepository.rejectApplication', () => {
  beforeEach(() => {
    m.updateMany.mockReset();
    m.findFirst.mockReset();
  });

  it('updates only an application that is still active', async () => {
    m.updateMany.mockResolvedValue({ count: 1 });
    m.findFirst.mockResolvedValue({ id: APP, status: 'rejected' });
    const { pipelineRepository } = await import('../../packages/api/src/repositories/pipeline.repository');
    const row = await pipelineRepository.rejectApplication(APP, 'NOT_QUALIFIED: No cumple requisitos', 'nota');
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APP, status: 'active' },
        data: expect.objectContaining({ status: 'rejected', rejectedReason: 'NOT_QUALIFIED: No cumple requisitos' }),
      }),
    );
    expect(row).toEqual({ id: APP, status: 'rejected' });
  });

  it('returns null and writes nothing further when the application is no longer active', async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    const { pipelineRepository } = await import('../../packages/api/src/repositories/pipeline.repository');
    expect(await pipelineRepository.rejectApplication(APP, 'r')).toBeNull();
    expect(m.findFirst).not.toHaveBeenCalled();
  });
});

describe('pipelineService.rejectCandidate', () => {
  it('reports a conflict when the application changed state between read and write', async () => {
    vi.resetModules();
    vi.doMock('../../packages/api/src/repositories/pipeline.repository', () => ({
      pipelineRepository: {
        findApplication: vi.fn().mockResolvedValue({ id: APP, status: 'active' }),
        rejectApplication: vi.fn().mockResolvedValue(null),
      },
    }));
    const { pipelineService } = await import('../../packages/api/src/services/pipeline.service');
    await expect(pipelineService.rejectCandidate('org', APP, 'r')).rejects.toMatchObject({ code: 'CONFLICT' });
    vi.doUnmock('../../packages/api/src/repositories/pipeline.repository');
  });
});
