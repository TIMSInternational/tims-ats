import { describe, it, expect, vi } from 'vitest';
import { assertSubjectInScope } from '../../packages/api/src/access/write-rules';
import type { AccessContext } from '../../packages/api/src/access';

// Fake request-local anchors (the real loader is tested in anchors.test.ts).
// teamMemberIds floors to [self]; unitMemberIds floors to [].
const makeAnchors = () => ({
  teamMemberIds: vi.fn(async () => ['me', 'u2']),
  unitIds: vi.fn(async () => ['bu1']),
  panelInterviewIds: vi.fn(async () => ['i1']),
  ledTeamIds: vi.fn(async () => ['t1']),
  unitMemberIds: vi.fn(async () => ['u1', 'u2']),
});

const ctx = (scope: string, anchors: ReturnType<typeof makeAnchors> | null): AccessContext =>
  ({ allowed: true, scope, roles: ['x'], anchors }) as unknown as AccessContext;

const ME = 'me';
const MSG = 'No puedes';

describe('assertSubjectInScope — write-rule for creates targeting a user', () => {
  it('organization → no-op, anchors never consulted', async () => {
    const anchors = makeAnchors();
    await expect(assertSubjectInScope(ctx('organization', anchors), ME, 'anyone', MSG)).resolves.toBeUndefined();
    expect(anchors.teamMemberIds).not.toHaveBeenCalled();
    expect(anchors.unitMemberIds).not.toHaveBeenCalled();
  });

  it('company → no-op, anchors never consulted', async () => {
    const anchors = makeAnchors();
    await expect(assertSubjectInScope(ctx('company', anchors), ME, 'anyone', MSG)).resolves.toBeUndefined();
    expect(anchors.teamMemberIds).not.toHaveBeenCalled();
    expect(anchors.unitMemberIds).not.toHaveBeenCalled();
  });

  it('own → self passes (no anchor query)', async () => {
    const anchors = makeAnchors();
    await expect(assertSubjectInScope(ctx('own', anchors), ME, ME, MSG)).resolves.toBeUndefined();
    expect(anchors.teamMemberIds).not.toHaveBeenCalled();
    expect(anchors.unitMemberIds).not.toHaveBeenCalled();
  });

  it('own → other target is FORBIDDEN', async () => {
    await expect(assertSubjectInScope(ctx('own', makeAnchors()), ME, 'someone-else', MSG)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: MSG,
    });
  });

  it('team → member target passes', async () => {
    await expect(assertSubjectInScope(ctx('team', makeAnchors()), ME, 'u2', MSG)).resolves.toBeUndefined();
  });

  it('team → non-member target is FORBIDDEN', async () => {
    await expect(assertSubjectInScope(ctx('team', makeAnchors()), ME, 'outsider', MSG)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: MSG,
    });
  });

  it('unit → member target passes', async () => {
    await expect(assertSubjectInScope(ctx('unit', makeAnchors()), ME, 'u1', MSG)).resolves.toBeUndefined();
  });

  it('unit → non-member target is FORBIDDEN', async () => {
    await expect(assertSubjectInScope(ctx('unit', makeAnchors()), ME, 'outsider', MSG)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: MSG,
    });
  });

  it('narrow scope with null anchors → FORBIDDEN (never silently unscoped)', async () => {
    await expect(assertSubjectInScope(ctx('team', null), ME, 'u2', MSG)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: MSG,
    });
  });
});
