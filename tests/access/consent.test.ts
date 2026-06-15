import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirstMock = vi.fn();
vi.mock('@tims/db', () => ({
  tenantDb: { dataConsent: { findFirst: (args: unknown) => findFirstMock(args) } },
}));

import { hasConsent, assertConsent } from '../../packages/api/src/access/consent';

beforeEach(() => findFirstMock.mockReset());

describe('hasConsent', () => {
  it('true when an active (not withdrawn) consent row exists', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'c1' });
    expect(await hasConsent('org1', 'subj1', 'dei_demographics')).toBe(true);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        organizationId: 'org1',
        subjectUserId: 'subj1',
        consentType: 'dei_demographics',
        withdrawnAt: null,
      },
      select: { id: true },
    });
  });
  it('false when no row (or withdrawn)', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    expect(await hasConsent('org1', 'subj1', 'dei_demographics')).toBe(false);
  });
});

describe('assertConsent', () => {
  it('throws FORBIDDEN when consent absent', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await expect(assertConsent('org1', 'subj1', 'dei_demographics')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('resolves when consent present', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'c1' });
    await expect(assertConsent('org1', 'subj1', 'dei_demographics')).resolves.toBeUndefined();
  });
});
