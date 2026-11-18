import { describe, it, expect, vi } from 'vitest';

// Codex round 3 on #421 (P2): unparsed uploads must never push an older, parsed CV out of the
// three documents the guide reads.
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn().mockResolvedValue(null) }));
vi.mock('@tims/db', async () => {
  const actual = await vi.importActual<typeof import('@tims/db')>('@tims/db');
  return { ...actual, tenantDb: { interview: { findFirst } } };
});

import { Prisma } from '@tims/db';
import { interviewAiRepository } from '../../packages/api/src/repositories/interview-ai.repository';

describe('interviewAiRepository.findInterviewForAi', () => {
  it('filters unparsed CV documents out BEFORE taking the newest three', async () => {
    await interviewAiRepository.findInterviewForAi('org-1', 'iv-1');
    const args = findFirst.mock.calls[0]![0];
    const documents = args.select.candidate.select.documents;
    expect(documents.take).toBe(3);
    expect(documents.where).toEqual({ organizationId: 'org-1', type: 'cv', parsedData: { not: Prisma.AnyNull } });
  });
});
