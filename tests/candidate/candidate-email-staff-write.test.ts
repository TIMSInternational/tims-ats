import { beforeEach, describe, expect, it, vi } from 'vitest';

// #315 — staff create/update store the canonical (trimmed + lowercased) email and refuse a
// case/whitespace variant of another candidate's email: the DB unique (organization_id, email)
// is case-sensitive, so it alone would let `Ana@x.com` and `ana@x.com` become two identities.

const m = vi.hoisted(() => ({
  findIdsByCanonicalEmail: vi.fn(async (): Promise<string[]> => []),
  create: vi.fn(async () => ({ id: 'new' })),
  update: vi.fn(async () => ({ id: 'c1' })),
  exists: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'c1' })),
  dbFindMany: vi.fn(),
}));

vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: {
    findIdsByCanonicalEmail: m.findIdsByCanonicalEmail,
    create: m.create,
    update: m.update,
    exists: m.exists,
  },
}));
vi.mock('../../packages/api/src/services/candidate-ai.service', () => ({ candidateAiService: {} }));
vi.mock('../../packages/api/src/services/consent-guard.service', () => ({ consentGuard: {} }));

import { candidateService } from '../../packages/api/src/services/candidate.service';

const ORG = 'org-1';
const base = { firstName: 'Ana', lastName: 'P', source: 'manual', poolType: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  m.findIdsByCanonicalEmail.mockResolvedValue([]);
  m.exists.mockResolvedValue({ id: 'c1' });
});

describe('candidateService.create (#315)', () => {
  it('stores the canonical email', async () => {
    await candidateService.create(ORG, 'u1', { ...base, email: '  Ana.P@Example.COM ' });
    expect(m.findIdsByCanonicalEmail).toHaveBeenCalledWith(ORG, 'ana.p@example.com');
    expect(m.create).toHaveBeenCalledWith(ORG, 'u1', expect.objectContaining({ email: 'ana.p@example.com' }));
  });

  it('refuses a case variant of an existing candidate with CONFLICT and writes nothing', async () => {
    m.findIdsByCanonicalEmail.mockResolvedValueOnce(['legacy']);
    await expect(candidateService.create(ORG, 'u1', { ...base, email: 'ANA.P@example.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe('candidateService.update (#315)', () => {
  it('canonicalizes a changed email, ignoring the candidate itself', async () => {
    m.findIdsByCanonicalEmail.mockResolvedValueOnce(['c1']);
    await candidateService.update(ORG, 'c1', { email: ' Ana@X.com', firstName: 'Ana' });
    expect(m.update).toHaveBeenCalledWith('c1', { email: 'ana@x.com', firstName: 'Ana' });
  });

  it('refuses an email that canonically belongs to ANOTHER candidate', async () => {
    m.findIdsByCanonicalEmail.mockResolvedValueOnce(['other']);
    await expect(candidateService.update(ORG, 'c1', { email: 'Taken@x.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('leaves updates without an email untouched and skips the lookup', async () => {
    await candidateService.update(ORG, 'c1', { firstName: 'Ana' });
    expect(m.findIdsByCanonicalEmail).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith('c1', { firstName: 'Ana' });
  });
});
