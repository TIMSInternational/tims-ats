import { tenantDb as db } from '@tims/db';

// ---------------------------------------------------------------------------
// DEI repository — demographic aggregation queries.
//
// Every method returns AGGREGATES (grouped counts) — never an individual's
// demographic row — so sensitive self-ID data is never exposed per record
// (CLAUDE.md §7).
//
// TS-DELETION (2026-07-31): countActiveEmployees / countWithDemographics /
// genderCounts / nationalityCounts / nullNationalityCount / birthDates /
// nullBirthDateCount / displayCurrency / salaryWithGender / leadershipGenders
// (+ the LEADERSHIP_SLUGS constant they used) were deleted — each was used
// exclusively by a dei.service.ts method deleted in the same cutover (see
// packages/api/src/services/dei.service.ts), so all were dead code once their
// callers were gone. Only ethnicityCounts and disabilityCounts remain: both are
// still used by getEthnicityDistribution/getDisabilityDistribution, the
// zero-FE-consumer exceptions kept in dei.service.ts.
// ---------------------------------------------------------------------------

export const deiRepository = {
  ethnicityCounts(orgId: string) {
    return db.employeeDemographics.groupBy({
      by: ['ethnicity'],
      where: { organizationId: orgId },
      _count: { _all: true },
    });
  },

  disabilityCounts(orgId: string) {
    return db.employeeDemographics.groupBy({
      by: ['disabilityStatus'],
      where: { organizationId: orgId },
      _count: { _all: true },
    });
  },
};
