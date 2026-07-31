import { TRPCError } from '@trpc/server';
import { accessReviewRepository } from '../repositories/access-review.repository';
import { assessUserAccess, type AccessStatus, type AccessRiskFlags } from '../access/access-review-kernel';

// CB-2b — access-review orchestration: apply the risk kernel, shape rows, compute the
// per-org summary that feeds a recertification attestation. Pure of tRPC/audit concerns
// (the router audits). `now` is injected for deterministic tests.

export interface RoleGrantView {
  slug: string;
  name: string;
  roleActive: boolean;
  assignedAt: Date;
  assignedBy: string | null;
  companyScope: string | null;
  unitScope: string | null;
  expiresAt: Date | null;
  grants: string[]; // 'module:action:scope'
}

export interface AccessReviewRow {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  orgName: string | null;
  status: AccessStatus;
  isPlatformOwner: boolean;
  lastLoginAt: Date | null;
  roles: RoleGrantView[];
  flags: AccessRiskFlags;
}

export interface AccessReviewSummary {
  userCount: number;
  privilegedCount: number;
  staleCount: number;
  deprovisionGapCount: number;
  expiredGapCount: number;
}

export interface AccessReviewReport {
  rows: AccessReviewRow[];
  summary: AccessReviewSummary;
  /** Data-integrity anomaly count (grant corruption) — surfaced, not part of the attestation snapshot. */
  crossOrgRoleCount: number;
  /** true when more users exist than the cap (rows are the first `cap`) — honest, no silent truncation. */
  truncated: boolean;
}

// The review is always ORG-SCOPED (the attestation/export/audit unit). One org is
// bounded per-tenant, so a high safety cap guards memory; `attest` REFUSES a truncated
// org rather than persist under-counted (false) evidence.
const ORG_CAP = 10000;

type ReviewUser = Awaited<ReturnType<typeof accessReviewRepository.fetchUsersForReview>>[number];

function toRow(u: ReviewUser, now: Date): AccessReviewRow {
  const { status, flags } = assessUserAccess({
    organizationId: u.organizationId ?? '',
    isActive: u.isActive,
    deletedAt: u.deletedAt,
    lastLoginAt: u.lastLoginAt,
    roles: u.userRoles.map((ur) => ({
      slug: ur.role.slug,
      organizationId: ur.role.organizationId,
      expiresAt: ur.expiresAt,
    })),
    isPlatformOwner: u.isPlatformOwner,
    now,
  });
  return {
    userId: u.id,
    name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
    email: u.email,
    organizationId: u.organizationId ?? '',
    orgName: u.organization?.name ?? null,
    status,
    isPlatformOwner: u.isPlatformOwner,
    lastLoginAt: u.lastLoginAt,
    roles: u.userRoles.map((ur) => ({
      slug: ur.role.slug,
      name: ur.role.name,
      roleActive: ur.role.isActive,
      assignedAt: ur.assignedAt,
      assignedBy: ur.assignedBy,
      companyScope: ur.companyScope,
      unitScope: ur.unitScope,
      expiresAt: ur.expiresAt,
      grants: ur.role.rolePermissions.map((rp) => `${rp.permission.module}:${rp.permission.action}:${rp.scope}`),
    })),
    flags,
  };
}

function summarize(rows: AccessReviewRow[]): AccessReviewSummary {
  return {
    userCount: rows.length,
    privilegedCount: rows.filter((r) => r.flags.privileged).length,
    staleCount: rows.filter((r) => r.flags.stale).length,
    deprovisionGapCount: rows.filter((r) => r.flags.deprovisionGap).length,
    expiredGapCount: rows.filter((r) => r.flags.expiredGrant).length,
  };
}

export const accessReviewService = {
  async buildReport(organizationId: string, now: Date): Promise<AccessReviewReport> {
    const users = await accessReviewRepository.fetchUsersForReview(organizationId, ORG_CAP);
    const truncated = users.length > ORG_CAP;
    const rows = (truncated ? users.slice(0, ORG_CAP) : users).map((u) => toRow(u, now));
    return {
      rows,
      summary: summarize(rows),
      crossOrgRoleCount: rows.filter((r) => r.flags.crossOrgRole).length,
      truncated,
    };
  },

  /**
   * Record a per-org recertification: recompute the org's snapshot and persist it as
   * durable CC6.2–6.3 evidence. REFUSES a truncated org (would persist under-counted =
   * false compliance evidence). Returns the attestation + the summary it was built from.
   */
  async attest(
    organizationId: string,
    reviewerId: string,
    notes: string | null,
    now: Date,
  ): Promise<{
    attestation: Awaited<ReturnType<typeof accessReviewRepository.insertAttestation>>;
    summary: AccessReviewSummary;
  }> {
    if (!(await accessReviewRepository.orgExists(organizationId))) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Organizacion no encontrada' });
    }
    const report = await this.buildReport(organizationId, now);
    if (report.truncated) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `La organizacion excede ${ORG_CAP} usuarios; no se puede certificar automaticamente sin subcontar`,
      });
    }
    const { summary } = report;
    const attestation = await accessReviewRepository.insertAttestation({
      organizationId,
      reviewerId,
      userCount: summary.userCount,
      privilegedCount: summary.privilegedCount,
      staleCount: summary.staleCount,
      deprovisionGapCount: summary.deprovisionGapCount,
      expiredGapCount: summary.expiredGapCount,
      notes,
    });
    return { attestation, summary };
  },
};
