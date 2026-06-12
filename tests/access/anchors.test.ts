import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tims/db', () => ({
  tenantDb: {
    team: { findMany: vi.fn() },
    userTeam: { findMany: vi.fn() },
    userBusinessUnit: { findMany: vi.fn() },
    interviewEvaluator: { findMany: vi.fn() },
  },
}));

import { createAnchorLoader } from '../../packages/api/src/access/anchors';
import { tenantDb } from '@tims/db';

const ORG = 'org-1';
const ME = 'user-me';

beforeEach(() => vi.clearAllMocks());

describe('createAnchorLoader', () => {
  it('teamMemberIds = members of teams the user LEADS (self included)', async () => {
    vi.mocked(tenantDb.team.findMany).mockResolvedValue([{ id: 't1' }, { id: 't2' }] as never);
    vi.mocked(tenantDb.userTeam.findMany).mockResolvedValue(
      [{ userId: 'u1' }, { userId: 'u2' }] as never,
    );
    const anchors = createAnchorLoader(ORG, ME);
    expect(new Set(await anchors.teamMemberIds())).toEqual(new Set(['u1', 'u2', ME]));
    expect(tenantDb.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leaderId: ME, organizationId: ORG }) }),
    );
  });

  it('leads no teams → teamMemberIds = [self] and skips the member query', async () => {
    vi.mocked(tenantDb.team.findMany).mockResolvedValue([] as never);
    const anchors = createAnchorLoader(ORG, ME);
    expect(await anchors.teamMemberIds()).toEqual([ME]);
    expect(tenantDb.userTeam.findMany).not.toHaveBeenCalled();
  });

  it('memoizes within the request (second call = no second query)', async () => {
    vi.mocked(tenantDb.team.findMany).mockResolvedValue([] as never);
    const anchors = createAnchorLoader(ORG, ME);
    await anchors.teamMemberIds();
    await anchors.teamMemberIds();
    expect(tenantDb.team.findMany).toHaveBeenCalledTimes(1);
  });

  it('does NOT share state across loader instances (no cross-request cache)', async () => {
    vi.mocked(tenantDb.team.findMany).mockResolvedValue([] as never);
    await createAnchorLoader(ORG, ME).teamMemberIds();
    await createAnchorLoader(ORG, ME).teamMemberIds();
    expect(tenantDb.team.findMany).toHaveBeenCalledTimes(2);
  });

  it('unitIds = currently assigned ACTIVE business units', async () => {
    vi.mocked(tenantDb.userBusinessUnit.findMany).mockResolvedValue(
      [{ businessUnitId: 'bu1' }] as never,
    );
    const anchors = createAnchorLoader(ORG, ME);
    expect(await anchors.unitIds()).toEqual(['bu1']);
    expect(tenantDb.userBusinessUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, userId: ME, businessUnit: { isActive: true } } }),
    );
  });

  it('panelInterviewIds = interviews where user is an evaluator (org-filtered)', async () => {
    vi.mocked(tenantDb.interviewEvaluator.findMany).mockResolvedValue(
      [{ interviewId: 'i1' }] as never,
    );
    const anchors = createAnchorLoader(ORG, ME);
    expect(await anchors.panelInterviewIds()).toEqual(['i1']);
    expect(tenantDb.interviewEvaluator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: ME, interview: { organizationId: ORG } } }),
    );
  });

  it('ledTeamIds = ids of active teams the user LEADS (floor [], fail-narrow)', async () => {
    vi.mocked(tenantDb.team.findMany).mockResolvedValue([{ id: 't1' }, { id: 't2' }] as never);
    const anchors = createAnchorLoader(ORG, ME);
    expect(await anchors.ledTeamIds()).toEqual(['t1', 't2']);
    expect(tenantDb.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG, leaderId: ME, isActive: true }),
      }),
    );
  });

  it('ledTeamIds floors to [] when the user leads nothing (NOT [self])', async () => {
    vi.mocked(tenantDb.team.findMany).mockResolvedValue([] as never);
    expect(await createAnchorLoader(ORG, ME).ledTeamIds()).toEqual([]);
  });

  it('ledTeamIds memoizes within the request', async () => {
    vi.mocked(tenantDb.team.findMany).mockResolvedValue([] as never);
    const anchors = createAnchorLoader(ORG, ME);
    await anchors.ledTeamIds();
    await anchors.ledTeamIds();
    expect(tenantDb.team.findMany).toHaveBeenCalledTimes(1);
  });
});
