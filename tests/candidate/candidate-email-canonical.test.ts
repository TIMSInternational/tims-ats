import { beforeEach, describe, expect, it, vi } from 'vitest';

// #315 — canonical candidate email identity on the candidate-portal read path. The portal is
// served by the TS candidatePortal router (no C# flag routes it), so these exercise the REAL
// repository against a mocked tenantDb, plus the pure helpers it is built on.

const m = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));

vi.mock('@tims/db', () => ({
  db: { organization: { findUnique: vi.fn() } },
  tenantDb: { candidate: { findMany: m.findMany, findFirst: m.findFirst } },
}));

import {
  canonicalizeEmail,
  escapeLikePattern,
  pickCanonicalEmailMatch,
} from '../../packages/api/src/lib/candidate-email';
import { candidatePortalRepo } from '../../packages/api/src/repositories/candidate-portal.repository';

const ORG = 'org-1';

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset also drops any unconsumed *Once values, so a test can never leak into the next.
  m.findMany.mockReset().mockResolvedValue([]);
  m.findFirst.mockReset().mockResolvedValue(null);
});

describe('canonicalizeEmail / escapeLikePattern', () => {
  it('trims and lowercases', () => {
    expect(canonicalizeEmail('  Ana.Perez@Example.COM \t')).toBe('ana.perez@example.com');
    expect(canonicalizeEmail('   ')).toBe('');
  });

  it('escapes LIKE metacharacters so the pattern is literal', () => {
    expect(escapeLikePattern('a_b%c\\d@x.com')).toBe('a\\_b\\%c\\\\d@x.com');
  });
});

describe('pickCanonicalEmailMatch', () => {
  const rows = [
    { id: 'oldest', email: 'ANA@x.com' },
    { id: 'canonical', email: 'ana@x.com' },
    { id: 'padded', email: ' Ana@X.com ' },
    { id: 'neighbour', email: 'xana@x.com' },
  ];

  it('prefers the row byte-identical to the session email (pre-#315 behaviour preserved)', () => {
    expect(pickCanonicalEmailMatch(rows, ' Ana@X.com ')?.id).toBe('padded');
    expect(pickCanonicalEmailMatch(rows, 'ANA@x.com')?.id).toBe('oldest');
  });

  it('then the canonically stored row, then the oldest variant', () => {
    expect(pickCanonicalEmailMatch(rows, 'Ana@x.com')?.id).toBe('canonical');
    expect(
      pickCanonicalEmailMatch(
        rows.filter((r) => r.id !== 'canonical'),
        'aNa@x.com',
      )?.id,
    ).toBe('oldest');
  });

  it('never matches a superstring or a wildcard neighbour', () => {
    expect(pickCanonicalEmailMatch([{ id: 'n', email: 'xana@x.com' }], 'ana@x.com')).toBeNull();
    expect(pickCanonicalEmailMatch([{ id: 'n', email: 'aXb@x.com' }], 'a_b@x.com')).toBeNull();
  });

  it('returns null for a blank session email', () => {
    expect(pickCanonicalEmailMatch(rows, '  ')).toBeNull();
  });
});

describe('candidatePortalRepo.findActiveCandidate (#315)', () => {
  it('fast path: exact match on the session email or its canonical form, active + not deleted, org-scoped', async () => {
    m.findMany.mockResolvedValueOnce([{ id: 'c1', email: 'ana@x.com' }]);
    await expect(candidatePortalRepo.findActiveCandidate(ORG, 'Ana@X.com')).resolves.toEqual({ id: 'c1' });
    expect(m.findMany).toHaveBeenCalledTimes(1);
    const where = m.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: ORG, isActive: true, deletedAt: null });
    expect(where.email).toEqual({ in: ['Ana@X.com', 'ana@x.com'] });
    expect(m.findMany.mock.calls[0][0].select).toEqual({ id: true, email: true });
  });

  it('finds a LEGACY mixed-case / padded row via the escaped case-insensitive fallback', async () => {
    m.findMany
      .mockResolvedValueOnce([]) // no exact row
      .mockResolvedValueOnce([
        { id: 'neighbour', email: 'maria_lopez@x.com.co' },
        { id: 'legacy', email: ' Maria_Lopez@X.com ' },
      ]);
    await expect(candidatePortalRepo.findActiveCandidate(ORG, 'maria_lopez@x.com')).resolves.toEqual({ id: 'legacy' });
    const fallback = m.findMany.mock.calls[1][0];
    expect(fallback.where).toMatchObject({ organizationId: ORG, isActive: true, deletedAt: null });
    expect(fallback.where.email).toEqual({ contains: 'maria\\_lopez@x.com', mode: 'insensitive' });
    expect(fallback.take).toBeGreaterThan(0);
  });

  it('fails closed: a wildcard neighbour returned by the database is never accepted', async () => {
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'other', email: 'aXb@x.com' }]);
    await expect(candidatePortalRepo.findActiveCandidate(ORG, 'a_b@x.com')).resolves.toBeNull();
  });

  it('a blank session email resolves to null without querying', async () => {
    await expect(candidatePortalRepo.findActiveCandidate(ORG, '   ')).resolves.toBeNull();
    expect(m.findMany).not.toHaveBeenCalled();
  });
});

describe('candidatePortalRepo profile/name lookups (#315)', () => {
  it('findActiveCandidateProfile resolves case-insensitively, then reads by id with an explicit select', async () => {
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'legacy', email: 'ANA@X.COM' }]);
    m.findFirst.mockResolvedValueOnce({ id: 'legacy', firstName: 'Ana', lastName: 'P' });
    await expect(candidatePortalRepo.findActiveCandidateProfile(ORG, 'ana@x.com')).resolves.toEqual({
      id: 'legacy',
      firstName: 'Ana',
      lastName: 'P',
    });
    expect(m.findFirst.mock.calls[0][0]).toEqual({
      where: { id: 'legacy', organizationId: ORG, isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
  });

  it('findCandidateName returns null and skips the read when no candidate matches', async () => {
    await expect(candidatePortalRepo.findCandidateName(ORG, 'nobody@x.com')).resolves.toBeNull();
    expect(m.findFirst).not.toHaveBeenCalled();
  });
});
