import { deiRepository } from '../repositories/dei.repository';
import { buildDistribution } from '@tims/shared';

// ---------------------------------------------------------------------------
// DEI service — turns demographic aggregates into the metrics the dashboard
// shows. All inputs are already grouped counts (no individual rows); this layer
// only computes percentages via the shared distribution kernel.
//
// The suppression + shaping logic lives in the PURE @tims/shared/dei.ts kernel
// (buildDistribution), golden-fixtured against contracts/dei-fixtures/*.json and
// shared byte-for-byte with the C# port (Tims.Domain.Dei.DeiKernels, Phase-5
// Slice 11b). This service only threads the repository aggregates into that
// kernel and maps the generic {key,count} distribution shape to each endpoint's
// field name.
//
// k-anonymity (Wave 2.5 slice 6, matrix §21): a demographic group of 1..4 people
// re-identifies individuals, so the kernel routes every per-group head-count
// through the min-5 floor and, when ANY group/bucket is sub-floor, emits an EMPTY
// distribution (no per-group keys) + a single top-level `suppressed: true`. min-5
// IS the disclosure mechanism here — it sits on top of the `dei:read` grant.
//
// TS-DELETION (2026-07-31): getDashboardKpis / getGenderRepresentation /
// getAgeDistribution / getNationalityDiversity / getPayEquity /
// getLeadershipDiversity were deleted (their sole caller, the router's matching
// procedure, was deleted after NEXT_PUBLIC_DEI_READ_VIA_CSHARP went live) — see
// packages/api/src/routers/dei.ts. Only getEthnicityDistribution and
// getDisabilityDistribution remain: zero-FE-consumer exceptions, out of scope.
// ---------------------------------------------------------------------------

export const deiService = {
  async getEthnicityDistribution(orgId: string) {
    const counts = await deiRepository.ethnicityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const sorted = counts.map((c) => ({ key: c.ethnicity, count: c._count._all })).sort((a, b) => b.count - a.count);
    const dist = buildDistribution(sorted, total);
    return {
      groups: dist.groups.map((g) => ({
        ethnicity: g.key,
        count: g.count,
        percentage: g.percentage,
        suppressed: g.suppressed,
      })),
      suppressed: dist.suppressed,
    };
  },

  async getDisabilityDistribution(orgId: string) {
    const counts = await deiRepository.disabilityCounts(orgId);
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const dist = buildDistribution(
      counts.map((c) => ({ key: c.disabilityStatus, count: c._count._all })),
      total,
    );
    return {
      groups: dist.groups.map((g) => ({
        status: g.key,
        count: g.count,
        percentage: g.percentage,
        suppressed: g.suppressed,
      })),
      suppressed: dist.suppressed,
    };
  },
};
