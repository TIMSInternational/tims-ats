import { router } from '../../trpc';
import { platformProcedure } from './_common';
import { accessReviewService } from '../../services/access-review.service';
import { logPlatformExport, logSecurityEvent } from '../../access/security-audit';
import {
  accessReviewReportInput,
  exportAccessReviewCsvInput,
  attestAccessReviewInput,
  listAccessReviewAttestationsInput,
} from './access-review.schemas';

// RFC-4180 CSV cell + spreadsheet formula-injection defense: neutralize a leading
// =/+/-/@/tab/CR (Excel/Sheets execute these), then double-quote and escape quotes.
// Fields originate from tenant-editable data (names, org names) and are opened in an
// auditor's spreadsheet, so this MUST be hardened.
function csvCell(value: string | null | undefined): string {
  const raw = value == null ? '' : String(value);
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

// CB-2b — access review + per-org recertification (SOC 2 CC6.2–6.3 / ISO A.5.18).
// Platform-owner-only; reads/writes via the privileged db across orgs.
export const accessReviewRouter = router({
  // The report: one org's users × roles × grants × last-login × risk flags. REQUIRES an
  // org (no unauditable platform-wide bulk read) and audits the access as a security
  // event — this dataset is the same sensitive aggregate the CSV export carries.
  getAccessReview: platformProcedure
    .input(accessReviewReportInput)
    .query(async ({ ctx, input }) => {
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
  exportAccessReviewCsv: platformProcedure
    .input(exportAccessReviewCsvInput)
    .query(async ({ ctx, input }) => {
      const report = await accessReviewService.buildReport(input.organizationId, new Date());
      logPlatformExport(ctx, {
        resource: 'access_review',
        count: report.rows.length,
        format: 'csv',
        targetOrgId: input.organizationId,
        truncated: report.truncated,
      });
      const header = [
        'Usuario', 'Email', 'Organizacion', 'Estado', 'Rol', 'Alcance', 'AsignadoPor',
        'Privilegiado', 'Inactivo', 'SinAcceso', 'BrechaBaja', 'Expirado', 'RolCruzado',
      ].map(csvCell).join(',');
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

  // Record a per-org recertification (the retained CC6.2–6.3 evidence) + a security event.
  attestAccessReview: platformProcedure
    .input(attestAccessReviewInput)
    .mutation(async ({ ctx, input }) => {
      const { attestation, summary } = await accessReviewService.attest(
        input.organizationId,
        ctx.user.id,
        input.notes ?? null,
        new Date(),
      );
      void logSecurityEvent({
        organizationId: input.organizationId,
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        action: 'access_recertified',
        entity: 'access_review',
        entityId: attestation.id,
        metadata: { ...summary },
      });
      return attestation;
    }),

  // Attestation history for one org — proves the quarterly cadence to an auditor.
  listAccessReviewAttestations: platformProcedure
    .input(listAccessReviewAttestationsInput)
    .query(({ input }) => accessReviewService.listAttestations(input.organizationId, input.limit)),
});
