import { router } from '../../trpc';
import { platformProcedure } from './_common';
import { accessReviewService } from '../../services/access-review.service';
import { logPlatformExport, logSecurityEvent } from '../../access/security-audit';
import { csvCell } from '@tims/shared';
import {
  accessReviewReportInput,
  exportAccessReviewCsvInput,
  listAccessReviewAttestationsInput,
} from './access-review.schemas';

// CB-2b — access review + per-org recertification (SOC 2 CC6.2–6.3 / ISO A.5.18).
// Platform-owner-only; reads/writes via the privileged db across orgs.
export const accessReviewRouter = router({
  // The report: one org's users × roles × grants × last-login × risk flags. REQUIRES an
  // org (no unauditable platform-wide bulk read) and audits the access as a security
  // event — this dataset is the same sensitive aggregate the CSV export carries.
  getAccessReview: platformProcedure.input(accessReviewReportInput).query(async ({ ctx, input }) => {
    const report = await accessReviewService.buildReport(input.organizationId, new Date());
    void logSecurityEvent({
      organizationId: input.organizationId,
      actorId: ctx.user.impersonatorId ?? ctx.user.id,
      action: 'access_review_viewed',
      entity: 'access_review',
      metadata: { targetOrgId: input.organizationId, userCount: report.summary.userCount },
    });
    return report;
  }),

  // CSV export (data egress) — REQUIRES an org (always auditable + bounded) and is
  // audited via the CB-1c logPlatformExport. One line per (user, role); users with no
  // role emit a single line with role '-'. Fields are RFC-4180 quoted + formula-safe.
  exportAccessReviewCsv: platformProcedure.input(exportAccessReviewCsvInput).query(async ({ ctx, input }) => {
    const report = await accessReviewService.buildReport(input.organizationId, new Date());
    logPlatformExport(ctx, {
      resource: 'access_review',
      count: report.rows.length,
      format: 'csv',
      targetOrgId: input.organizationId,
      truncated: report.truncated,
    });
    const header = [
      'Usuario',
      'Email',
      'Organizacion',
      'Estado',
      'Rol',
      'Alcance',
      'AsignadoPor',
      'Privilegiado',
      'Inactivo',
      'SinAcceso',
      'BrechaBaja',
      'Expirado',
      'RolCruzado',
    ]
      .map(csvCell)
      .join(',');
    const lines: string[] = [];
    for (const r of report.rows) {
      const roleList = r.roles.length ? r.roles : [null];
      for (const role of roleList) {
        lines.push(
          [
            csvCell(r.name),
            csvCell(r.email),
            csvCell(r.orgName),
            csvCell(r.status),
            csvCell(role?.slug ?? '-'),
            csvCell([role?.companyScope, role?.unitScope].filter(Boolean).join('|') || '-'),
            csvCell(role?.assignedBy ?? '-'),
            csvCell(r.flags.privileged ? 'Y' : 'N'),
            csvCell(r.flags.stale ? 'Y' : 'N'),
            csvCell(r.flags.neverLoggedIn ? 'Y' : 'N'),
            csvCell(r.flags.deprovisionGap ? 'Y' : 'N'),
            csvCell(r.flags.expiredGrant ? 'Y' : 'N'),
            csvCell(r.flags.crossOrgRole ? 'Y' : 'N'),
          ].join(','),
        );
      }
    }
    return {
      format: 'csv' as const,
      data: [header, ...lines].join('\n'),
      count: report.rows.length,
      truncated: report.truncated,
    };
  }),

  // NOTE: `attestAccessReview` (the recertification WRITE) was DELETED 2026-07-31 — its C#
  // port is confirmed live (`NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP=true`, parity-verified
  // 3/3 PASS via `scripts/parity/cli.ts verify-write access-review`) and the FE wrapper
  // (`apps/web/lib/platform-api/access-review.ts`'s `useAccessReviewAttest`) now calls the C#
  // endpoint unconditionally. See `accessReviewService.attest`'s removal for the equivalent note.

  // Attestation history for one org — proves the quarterly cadence to an auditor.
  listAccessReviewAttestations: platformProcedure
    .input(listAccessReviewAttestationsInput)
    .query(({ input }) => accessReviewService.listAttestations(input.organizationId, input.limit)),
});
