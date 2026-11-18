import { beforeEach, describe, expect, it, vi } from 'vitest';

// Codex round 2: "a key is recorded at most once" must hold under concurrency. The check and the insert run in
// one tenant transaction behind an advisory lock on the key (no schema change, so no unique constraint).

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  candidateDocument: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock('@tims/db', () => ({
  tenantDb: {},
  runTenantTransaction: async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
}));

import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

const ORG = '11111111-1111-4111-8111-111111111111';
const DATA = { candidateId: 'c1', type: 'cv', fileName: 'cv.pdf', fileUrl: `cv-uploads/${ORG}/k.pdf`, fileSize: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  tx.candidateDocument.create.mockResolvedValue({ id: 'doc-1' });
});

describe('candidateRepository.createDocumentOnce', () => {
  it('takes the key lock before checking, then inserts', async () => {
    tx.candidateDocument.findFirst.mockResolvedValue(null);
    expect(await candidateRepository.createDocumentOnce(ORG, DATA)).toEqual({ id: 'doc-1' });
    const lockSql = (tx.$executeRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(lockSql).toContain('pg_advisory_xact_lock');
    expect(tx.$executeRaw.mock.calls[0]![1]).toBe(`candidate_document_key:${ORG}:${DATA.fileUrl}`);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.candidateDocument.findFirst.mock.invocationCallOrder[0]!);
    expect(tx.candidateDocument.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, fileUrl: DATA.fileUrl },
      select: { id: true },
    });
  });

  it('returns null and inserts nothing when the key is already on record', async () => {
    tx.candidateDocument.findFirst.mockResolvedValue({ id: 'existing' });
    expect(await candidateRepository.createDocumentOnce(ORG, DATA)).toBeNull();
    expect(tx.candidateDocument.create).not.toHaveBeenCalled();
  });
});
