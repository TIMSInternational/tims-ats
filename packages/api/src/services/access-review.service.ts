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
// bounded per-tenant, so a high safety cap guards memory; the recertification write
// (now C#-only — see below) refuses a truncated org rather than persist under-counted
// (false) evidence.
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

  // NOTE: `attest()` (recompute → refuse-if-truncated → `insertAttestation`) was DELETED
  // 2026-07-31 — its C# port (`AccessReviewService.AttestAsync`) is confirmed live
  // (`NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP=true`, parity-verified 3/3 PASS) and is now
  // the sole writer of `access_reviews`. `buildReport` above stays in TS: it also backs the
  // read procedures below (`getAccessReview`/`exportAccessReviewCsv`) — their READ flag is
  // separately live, but their TS deletion is a distinct, out-of-scope task.

  listAttestations(organizationId: string, limit: number) {
    return accessReviewRepository.listAttestations(organizationId, limit);
  },
};
