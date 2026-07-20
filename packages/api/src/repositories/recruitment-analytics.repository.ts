import { tenantDb as db } from '@tims/db';

// ---------------------------------------------------------------------------
// Recruitment analytics repository — org-wide aggregation queries for the
// recruitment analytics dashboard. Returns aggregates or minimal projections
// (never full candidate/offer rows — CLAUDE.md Prisma safety).
// ---------------------------------------------------------------------------

export const recruitmentAnalyticsRepository = {
  /** Accepted offers in period with the timestamps needed for TTF/TTH. */
  acceptedOffers(orgId: string, from: Date) {
    return db.offer.findMany({
      where: { organizationId: orgId, status: 'accepted', respondedAt: { gte: from } },
      select: {
        respondedAt: true,
        vacancyId: true,
        vacancy: { select: { createdAt: true } },
        application: { select: { appliedAt: true, source: true } },
      },
    });
  },

  /** Offers sent in period (denominator of accept rate). gte excludes NULLs. */
  countOffersSent(orgId: string, from: Date) {
    return db.offer.count({
      where: { organizationId: orgId, sentAt: { gte: from } },
    });
  },

  /** Offers accepted in period (numerator of accept rate). */
  countOffersAccepted(orgId: string, from: Date) {
    return db.offer.count({
      where: { organizationId: orgId, status: 'accepted', respondedAt: { gte: from } },
    });
  },

  countApplications(orgId: string, from: Date) {
    return db.application.count({
      where: { organizationId: orgId, appliedAt: { gte: from } },
    });
  },

  countApplicationsAllTime(orgId: string) {
    return db.application.count({ where: { organizationId: orgId } });
  },

  countOffersAcceptedAllTime(orgId: string) {
    return db.offer.count({ where: { organizationId: orgId, status: 'accepted' } });
  },

  /** Applied-at timestamps in range — bucketed into months by the service. */
  applicationDates(orgId: string, from: Date) {
    return db.application.findMany({
      where: { organizationId: orgId, appliedAt: { gte: from } },
      select: { appliedAt: true },
      take: 20_000, // memory cap; switch to SQL month-grouping if an org ever hits this
    });
  },

  /** Pipeline stages of live vacancies (funnel merges them by name in the service). */
  allStages(orgId: string) {
    return db.pipelineStage.findMany({
      where: { organizationId: orgId, vacancy: { deletedAt: null } },
      select: { id: true, name: true, order: true, slaHours: true },
      // Deterministic order (order, then id) so the funnel merge/sort ties resolve identically here and in
      // the C# port (Phase-5 parity) — the aggregation is otherwise order-sensitive on equal `order`.
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
  },

  /** Active application counts per current stage. */
  activeCountsByStage(orgId: string) {
    return db.application.groupBy({
      by: ['currentStageId'],
      where: { organizationId: orgId, status: 'active' },
      _count: { _all: true },
    });
  },

  /** Application counts per source in period. */
  applicationsBySource(orgId: string, from: Date) {
    return db.application.groupBy({
      by: ['source'],
      where: { organizationId: orgId, appliedAt: { gte: from } },
      _count: { _all: true },
      // Deterministic input order so the kernel's stable "sort by applications desc" resolves equal-count
      // source ties identically here and in the C# port (Phase-5 parity).
      orderBy: { source: 'asc' },
    });
  },

  /** Sources of applications that converted to an accepted offer in period. */
  hireSources(orgId: string, from: Date) {
    return db.application.findMany({
      where: {
        organizationId: orgId,
        offers: { some: { status: 'accepted', respondedAt: { gte: from } } },
      },
      select: { source: true },
      take: 10_000, // memory cap — hires per period will not realistically approach this
    });
  },

  /**
   * Applications rejected in period, with their stage SLA and the moment they
   * entered their final stage — the service derives "lost while overdue".
   */
  rejectedApplications(orgId: string, from: Date) {
    return db.application.findMany({
      where: { organizationId: orgId, status: 'rejected', rejectedAt: { gte: from } },
      select: {
        appliedAt: true,
        rejectedAt: true,
        currentStage: { select: { name: true, slaHours: true } },
        movements: {
          orderBy: { movedAt: 'desc' },
          take: 1,
          select: { movedAt: true },
        },
      },
      // Deterministic order so the lost-by-delay group's FIRST-SEEN SLA (two same-name stages with
      // different SLA) resolves identically here and in the C# port (Phase-5 parity).
      orderBy: { id: 'asc' },
    });
  },

  /** Vacancies with an assigned recruiter (for the per-recruiter SLA table). */
  assignedVacancies(orgId: string) {
    return db.vacancy.findMany({
      where: { organizationId: orgId, assignedTo: { not: null }, deletedAt: null },
      select: {
        id: true,
        createdAt: true,
        assignedTo: true,
        assignee: { select: { firstName: true, lastName: true } },
      },
      // Deterministic order so the recruiter grouping (first-seen name + insertion order for the
      // vacancy-count tie sort) resolves identically here and in the C# port (Phase-5 parity).
      orderBy: { id: 'asc' },
    });
  },

  /** Application counts per vacancy (all statuses). */
  applicationCountsByVacancy(orgId: string) {
    return db.application.groupBy({
      by: ['vacancyId'],
      where: { organizationId: orgId },
      _count: { _all: true },
    });
  },

  /**
   * Active applications with stage SLA + entered-stage timestamp, for
   * SLA-compliance aggregation per recruiter.
   */
  activeApplicationsWithSla(orgId: string) {
    return db.application.findMany({
      where: { organizationId: orgId, status: 'active' },
      select: {
        vacancyId: true,
        appliedAt: true,
        currentStage: { select: { slaHours: true } },
        movements: {
          orderBy: { movedAt: 'desc' },
          take: 1,
          select: { movedAt: true },
        },
      },
      take: 10_000, // memory cap; compliance over a 10k-app sample is still representative
    });
  },
};
