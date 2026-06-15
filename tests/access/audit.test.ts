import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

const createMock = vi.fn();
vi.mock('@tims/db', () => ({
  tenantDb: { dataAccessLog: { create: (args: unknown) => createMock(args) } },
}));

import { logDataAccess, auditRequiredFor } from '../../packages/api/src/access/audit';

beforeEach(() => createMock.mockReset());

describe('auditRequiredFor — confidential/restricted require audit', () => {
  it('restricted entity requires audit', () => {
    expect(auditRequiredFor('employeeCompensation')).toBe(true);
  });
  it('confidential entity requires audit', () => {
    expect(auditRequiredFor('employeeDemographics')).toBe(true);
  });
  it('unregistered/internal entity does not', () => {
    expect(auditRequiredFor('vacancy')).toBe(false);
  });
});

describe('logDataAccess', () => {
  const base = {
    organizationId: 'org1',
    actorId: 'actor1',
    recordId: 'rec1',
    action: 'read' as const,
    ipAddress: '1.2.3.4',
    userAgent: 'jest',
  };

  it('writes a data_access_logs row with the right shape', async () => {
    createMock.mockResolvedValueOnce({});
    await logDataAccess({ ...base, entity: 'employeeDemographics' });
    expect(createMock).toHaveBeenCalledWith({
      data: {
        organizationId: 'org1',
        actorId: 'actor1',
        dataType: 'employeeDemographics',
        recordId: 'rec1',
        action: 'read',
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      },
    });
  });

  it('CONFIDENTIAL: a write failure is swallowed (fail-soft) — read proceeds', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'));
    await expect(logDataAccess({ ...base, entity: 'employeeDemographics' })).resolves.toBeUndefined();
  });

  it('RESTRICTED: a write failure THROWS (fail-closed) — read must abort', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'));
    await expect(logDataAccess({ ...base, entity: 'employeeCompensation' })).rejects.toBeInstanceOf(TRPCError);
  });

  it('RESTRICTED: a write success resolves normally', async () => {
    createMock.mockResolvedValueOnce({});
    await expect(logDataAccess({ ...base, entity: 'employeeCompensation' })).resolves.toBeUndefined();
  });
});

describe('logDataAccess — failClosed override (assessmentResult mixed-class table)', () => {
  const base = {
    organizationId: 'org1',
    actorId: 'actor1',
    recordId: 'rec1',
    action: 'read' as const,
    ipAddress: '1.2.3.4',
    userAgent: 'jest',
  };

  it('failClosed:true forces a THROW on a CONFIDENTIAL entity write-failure', async () => {
    // assessmentResult is `restricted` headline, but a super_admin reading the raw
    // fields passes failClosed:true; verify the override forces fail-closed even
    // if we point at a nominally-confidential entity.
    createMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      logDataAccess({ ...base, entity: 'employeeDemographics' }, { failClosed: true }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('failClosed:false SWALLOWS a write-failure on a RESTRICTED entity', async () => {
    // A recruiter reads only the confidential score fields of assessmentResult
    // (no breakdown/rawScore) → audited fail-SOFT so one lost row cannot abort
    // their bulk read, even though the entity's headline class is restricted.
    createMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      logDataAccess({ ...base, entity: 'assessmentResult' }, { failClosed: false }),
    ).resolves.toBeUndefined();
  });

  it('omitting opts keeps the dataClass-derived default (restricted → throws)', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      logDataAccess({ ...base, entity: 'assessmentResult' }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
