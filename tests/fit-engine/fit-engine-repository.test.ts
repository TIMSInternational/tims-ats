import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task 6 fix — getFitScoreForExplain must filter by organizationId (defense in
// depth per .claude/rules/api-security.md IDOR prevention), not just candidateId
// +vacancyId. FitScore's compound unique is [candidateId, vacancyId] only (see
// packages/db/prisma/schema/assessment.prisma), so this can't be a findUnique
// with organizationId folded into the compound key — it must be a findFirst
// with an explicit organizationId filter, mirroring getLatestAssessmentScore /
// getLatestInterviewFitScore in the same repository file.
// Pattern mirrors tests/pipeline/funnel-counts.test.ts: vi.mock('@tims/db') at
// the tenantDb boundary + import the real repository.

vi.mock('@tims/db', () => ({
  tenantDb: {
    fitScore: { findFirst: vi.fn() },
  },
}));

import { fitEngineRepository } from '../../packages/api/src/repositories/fit-engine.repository';
import { tenantDb } from '@tims/db';

beforeEach(() => vi.clearAllMocks());

describe('fitEngineRepository.getFitScoreForExplain', () => {
  it('filters by organizationId (not just candidateId+vacancyId) via findFirst', async () => {
    vi.mocked(tenantDb.fitScore.findFirst).mockResolvedValue(null as never);

    await fitEngineRepository.getFitScoreForExplain('org-1', 'candidate-1', 'vacancy-1');

    expect(tenantDb.fitScore.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { candidateId: 'candidate-1', vacancyId: 'vacancy-1', organizationId: 'org-1' },
      }),
    );
  });
});
