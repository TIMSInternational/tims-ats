import { tenantDb as db } from '@tims/db';

// ---------------------------------------------------------------------------
// DEI repository — demographic aggregation queries.
//
// Every method returns AGGREGATES (grouped counts) — never an individual's
// demographic row — so sensitive self-ID data is never exposed per record
// (CLAUDE.md §7). dateOfBirth is the one raw field read, and only to bucket into
// age bands server-side in the service (never returned raw).
// ---------------------------------------------------------------------------

// Role slugs that count as "leadership" for leadership-diversity metrics.
const LEADERSHIP_SLUGS = ['super_admin', 'org_admin', 'hr_admin', 'leader'];

export const deiRepository = {
  countActiveEmployees(orgId: string) {
    return db.user.count({ where: { organizationId: orgId, isActive: true } });
  },

  countWithDemographics(orgId: string) {
    return db.employeeDemographics.count({ where: { organizationId: orgId } });
  },

  genderCounts(orgId: string) {
    return db.employeeDemographics.groupBy({
      by: ['gender'],
      where: { organizationId: orgId },
      _count: { _all: true },
    });
  },

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

  nationalityCounts(orgId: string) {
    return db.employeeDemographics.groupBy({
      by: ['nationality'],
      where: { organizationId: orgId, nationality: { not: null } },
      _count: { _all: true },
    });
  },

  /**
   * Count of demographics rows with NO recorded nationality (the missing-value
   * bucket). nationalityCounts() filters these out, so without this the people
   * WITHOUT a nationality never participate in k-anonymity suppression — yet
   * (withDemographics − Σ visible) recovers that bucket. The service treats this
   * as an implicit group in its suppression decision (slice 6 round 8).
   */
  nullNationalityCount(orgId: string) {
    return db.employeeDemographics.count({
      where: { organizationId: orgId, nationality: null },
    });
  },

  /** Raw DOBs — server-side only, bucketed into age bands by the service. */
  birthDates(orgId: string) {
    return db.employeeDemographics.findMany({
      where: { organizationId: orgId, dateOfBirth: { not: null } },
      select: { dateOfBirth: true },
    });
  },

  /**
   * Count of demographics rows with NO recorded DOB (the missing-value bucket).
   * birthDates() filters these out, so the people WITHOUT a DOB never participate
   * in age-band suppression; (withDemographics − Σ visible bands) recovers the
   * bucket. The service folds this into getAgeDistribution's suppression decision.
   */
  nullBirthDateCount(orgId: string) {
    return db.employeeDemographics.count({
      where: { organizationId: orgId, dateOfBirth: null },
    });
  },

  /** Salary + gender pairs for pay-equity aggregation (aggregated in the service). */
  salaryWithGender(orgId: string) {
    return db.employeeCompensation.findMany({
      where: { organizationId: orgId },
      select: { currentSalary: true, user: { select: { demographics: { select: { gender: true } } } } },
    });
  },

  /** Gender of users holding a leadership role. */
  leadershipGenders(orgId: string) {
    return db.employeeDemographics.findMany({
      where: {
        organizationId: orgId,
        user: { userRoles: { some: { role: { slug: { in: LEADERSHIP_SLUGS } } } } },
      },
      select: { gender: true },
    });
  },
};
