import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Behavioral tests for DEI sub-floor leaks (round 7 supersedes round 6) ─────
// HIGH 4   getEthnicityDistribution: the round-6 fix kept the group keys (counts
//          nulled) and re-sorted alphabetically when suppressed to hide the
//          descending-by-count ranking channel. Round 7 SUPERSEDES that: when any
//          group is sub-floor the distribution is EMPTY (no keys at all), so there
//          is no order to leak. The not-suppressed path keeps descending-by-count.
//
// TS-DELETION (2026-07-31): the getNationalityDiversity (HIGH 4) and getDashboardKpis
// (MEDIUM 6) describe blocks that used to live here were retired together with their
// subjects — both procedures were deleted from dei.service.ts/dei.router.ts after
// NEXT_PUBLIC_DEI_READ_VIA_CSHARP went live (see packages/api/src/routers/dei.ts).
// getEthnicityDistribution survives (zero-FE-consumer exception, out of scope for
// that cutover), so its coverage stays.

vi.mock('../../packages/api/src/repositories/dei.repository', () => ({
  deiRepository: {
    ethnicityCounts: vi.fn(),
    disabilityCounts: vi.fn(),
  },
}));

import { deiService } from '../../packages/api/src/services/dei.service';
import { deiRepository } from '../../packages/api/src/repositories/dei.repository';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEthnicityDistribution present-key cardinality (HIGH 4, round 7)', () => {
  it('N=6 one-small → EMPTY distribution (no keys, no order to leak)', async () => {
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'white', _count: { _all: 5 } },
      { ethnicity: 'asian', _count: { _all: 1 } },
    ] as never);
    const r = await deiService.getEthnicityDistribution('org-1');
    expect(r.groups).toEqual([]);
    expect(r.suppressed).toBe(true);
  });

  it('all groups >= 5 → descending-by-count order preserved', async () => {
    vi.mocked(deiRepository.ethnicityCounts).mockResolvedValue([
      { ethnicity: 'asian', _count: { _all: 6 } },
      { ethnicity: 'white', _count: { _all: 30 } },
    ] as never);
    const r = await deiService.getEthnicityDistribution('org-1');
    expect(r.suppressed).toBe(false);
    expect(r.groups.map((d) => d.ethnicity)).toEqual(['white', 'asian']);
  });
});
