import { db } from '@tims/db';

// CB-2b — access-review data access (platform/privileged path; NOT tenantDb — the
// platform owner reviews across orgs). Only this file imports `db` for this domain.

/** One staff user with everything a review needs: status, roles, scopes, grants. */
export const reviewUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  organizationId: true,
  isActive: true,
  deletedAt: true,
  lastLoginAt: true,
  isPlatformOwner: true,
  organization: { select: { name: true } },
  userRoles: {
    select: {
      assignedAt: true,
      assignedBy: true,
      companyScope: true,
      unitScope: true,
      expiresAt: true,
      role: {
        select: {
          slug: true,
          name: true,
          isActive: true,
          organizationId: true, // to detect a cross-org (corrupt) grant
          rolePermissions: {
            select: { scope: true, permission: { select: { module: true, action: true } } },
          },
        },
      },
    },
  },
} as const;

export const accessReviewRepository = {
  /**
   * Fetch one org's users for the review, newest-first, bounded by `cap + 1` so the
   * caller can report truncation honestly (no silent cap). Always org-scoped — the
   * review/export/attestation unit is a single org.
   */
  async fetchUsersForReview(organizationId: string, cap: number) {
    return db.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: cap + 1,
      select: reviewUserSelect,
    });
  },

  // NOTE: `insertAttestation` and `orgExists` were DELETED 2026-07-31 alongside
  // `accessReviewService.attest()` — the C# write path is confirmed live and is now the sole
  // writer of `access_reviews`. See `packages/api/src/services/access-review.service.ts`.

  async listAttestations(organizationId: string, limit: number) {
    return db.accessReview.findMany({
      where: { organizationId },
      orderBy: { reviewedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        reviewedAt: true,
        userCount: true,
        privilegedCount: true,
        staleCount: true,
        deprovisionGapCount: true,
        expiredGapCount: true,
        notes: true,
        reviewer: { select: { firstName: true, lastName: true, email: true } },
      },
    });
  },
};
