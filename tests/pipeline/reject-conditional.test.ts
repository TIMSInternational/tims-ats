import { describe, expect, it, vi, beforeEach } from 'vitest';

// A rejection must only transition a STILL-active application, so it can never overwrite a hire (or a
// second rejection) that committed after the caller's status read. Who rejected is recorded as an audit row
// in the SAME transaction (A-05), and only when the rejection actually happened.

const tx = vi.hoisted(() => ({
  application: { updateMany: vi.fn(), findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('@tims/db', () => ({
  tenantDb: {},
  runWithTenant: (_o: string, fn: () => unknown) => fn(),
  runTenantTransaction: async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const APP = '33333333-3333-4333-8333-333333333333';
const ACTOR = { userId: 'u-recruiter', actorId: 'u-recruiter' };

describe('pipelineRepository.rejectApplication', () => {
  beforeEach(() => {
    tx.application.updateMany.mockReset();
    tx.application.findFirst.mockReset();
    tx.auditLog.create.mockReset();
  });

  it('updates only an application that is still active, then records who rejected it', async () => {
    tx.application.updateMany.mockResolvedValue({ count: 1 });
    tx.application.findFirst.mockResolvedValue({ id: APP, status: 'rejected' });
    const { pipelineRepository, APPLICATION_REJECTED_AUDIT_ACTION } = await import(
      '../../packages/api/src/repositories/pipeline.repository'
    );
    const row = await pipelineRepository.rejectApplication(
      ORG,
      APP,
      ACTOR,
      'NOT_QUALIFIED: No cumple requisitos',
      'nota',
      true,
    );
    expect(tx.application.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APP, organizationId: ORG, status: 'active' },
        data: expect.objectContaining({ status: 'rejected', rejectedReason: 'NOT_QUALIFIED: No cumple requisitos' }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: ORG,
        userId: ACTOR.userId,
        actorId: ACTOR.actorId,
        action: APPLICATION_REJECTED_AUDIT_ACTION,
        entity: 'application',
        entityId: APP,
        metadata: { candidateNotificationRequested: true },
      },
    });
    // The audit row carries neither the reason nor the internal note.
    expect(JSON.stringify(tx.auditLog.create.mock.calls[0])).not.toContain('nota');
    expect(tx.application.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.auditLog.create.mock.invocationCallOrder[0]!,
    );
    expect(row).toEqual({ id: APP, status: 'rejected' });
  });

  it('returns null and writes nothing further when the application is no longer active', async () => {
    tx.application.updateMany.mockResolvedValue({ count: 0 });
    const { pipelineRepository } = await import('../../packages/api/src/repositories/pipeline.repository');
    expect(await pipelineRepository.rejectApplication(ORG, APP, ACTOR, 'r')).toBeNull();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.application.findFirst).not.toHaveBeenCalled();
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
    await expect(pipelineService.rejectCandidate('org', ACTOR, APP, 'r')).rejects.toMatchObject({ code: 'CONFLICT' });
    vi.doUnmock('../../packages/api/src/repositories/pipeline.repository');
  });

  it('passes the actor and the notification request through to the repository', async () => {
    vi.resetModules();
    const rejectApplication = vi.fn().mockResolvedValue({ id: APP, status: 'rejected' });
    vi.doMock('../../packages/api/src/repositories/pipeline.repository', () => ({
      pipelineRepository: {
        findApplication: vi.fn().mockResolvedValue({ id: APP, status: 'active' }),
        rejectApplication,
      },
    }));
    const { pipelineService } = await import('../../packages/api/src/services/pipeline.service');
    await pipelineService.rejectCandidate('org', ACTOR, APP, 'r', 'f', true);
    expect(rejectApplication).toHaveBeenCalledWith('org', APP, ACTOR, 'r', 'f', true);
    vi.doUnmock('../../packages/api/src/repositories/pipeline.repository');
  });
});
