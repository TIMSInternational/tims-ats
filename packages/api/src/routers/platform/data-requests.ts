import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { logger } from '@tims/shared';
import { router } from '../../trpc';
import { db } from '@tims/db';
import { dataClassOf } from '../../access';
import { platformProcedure } from './_common';

// ---------------------------------------------------------------------------
// GDPR / Habeas Data (Ley 1581/2012) data-subject requests.
//
// exportSubjectData = the "right to access": bundle everything we hold about a
// person (matched by email across both the User/employee and Candidate sides)
// into a downloadable JSON. Single-subject, so no unbounded-result concern.
// Platform-owner only. Deletion requests are handled manually for now (they
// carry legal-retention nuance + cascade risk) — a separate future capability.
// ---------------------------------------------------------------------------

// §21 sensitive-read audit (data_access_logs) for this cross-org surface.
//
// `logDataAccess()` from ../../access is deliberately NOT used here, and must not
// be substituted in: it writes through `tenantDb`, and a platform owner who HAS an
// org of their own flows through `runWithTenant(ownOrg)` (trpc.ts:106-128), so the
// insert would run under `SET LOCAL ROLE app_tenant` with the org GUC pinned to the
// OPERATOR's org. A row carrying the SUBJECT's organizationId is then rejected by
// the fail-closed `tenant_isolation` WITH CHECK — which for the restricted
// (fail-closed) compensation rows would abort the export. It would break for
// exactly the operators who have an org and silently work for those who don't.
// This surface is cross-org by construction, so it writes through the privileged
// BYPASSRLS `db` with an explicit organizationId, the same way the `audit_logs`
// insert further down already does.
//
// Failure policy is derived from the SAME registry as logDataAccess
// (classification.ts): restricted → fail-CLOSED (throw before returning),
// confidential → fail-SOFT (log and continue). `opts.failClosed` overrides it for
// mixed-class tables, exactly as logDataAccess documents for assessmentResult.
async function auditSensitiveRead(
  actor: { actorId: string; ipAddress: string | null; userAgent: string | null },
  entity: string,
  rows: ReadonlyArray<{ id: string; organizationId: string }>,
  opts?: { failClosed?: boolean },
): Promise<void> {
  if (rows.length === 0) return;
  const failClosed = opts?.failClosed ?? dataClassOf(entity) === 'restricted';
  try {
    await db.dataAccessLog.createMany({
      data: rows.map((r) => ({
        organizationId: r.organizationId,
        actorId: actor.actorId,
        dataType: entity,
        recordId: r.id,
        action: 'export',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })),
    });
  } catch (err) {
    if (failClosed) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'No se pudo registrar el acceso a datos restringidos; acceso abortado',
        cause: err,
      });
    }
    logger.warn(
      { err, entity, rows: rows.length, actorId: actor.actorId },
      'data_access_logs write failed for DSAR export — continuing (fail-soft)',
    );
  }
}

export const dataRequestsRouter = router({
  exportSubjectData: platformProcedure
    .input(z.object({ email: z.string().email().max(255) }))
    .query(async ({ ctx, input }) => {
      // Don't pre-lowercase: stored emails aren't guaranteed normalized, so we
      // rely on Prisma `mode: 'insensitive'` to match regardless of casing.
      const email = input.email.trim();

      const [users, candidates] = await Promise.all([
        db.user.findMany({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            isActive: true,
            organizationId: true,
            createdAt: true,
          },
        }),
        db.candidate.findMany({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            source: true,
            currentTitle: true,
            organizationId: true,
            createdAt: true,
          },
        }),
      ]);

      if (users.length === 0 && candidates.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No se encontraron datos para ese correo' });
      }
      // NOTE (CB-1c): this DSAR export is already audited below as `data_subject_export`,
      // per affected SUBJECT org (better attribution than a generic platform_export), so
      // no logPlatformExport call is added here. That row records the EXPORT EVENT; the
      // §21 per-record `data_access_logs` rows written below are a separate obligation
      // and neither substitutes for the other.

      const candidateIds = candidates.map((c) => c.id);
      const userIds = users.map((u) => u.id);

      const [applications, interviews, offers, assessments, demographics, compensation] = await Promise.all([
        candidateIds.length
          ? db.application.findMany({
              where: { candidateId: { in: candidateIds } },
              select: { id: true, status: true, appliedAt: true, rejectedReason: true, vacancyId: true },
            })
          : [],
        candidateIds.length
          ? db.interview.findMany({
              where: { candidateId: { in: candidateIds } },
              select: { id: true, type: true, status: true, scheduledAt: true },
            })
          : [],
        candidateIds.length
          ? db.offer.findMany({
              where: { candidateId: { in: candidateIds } },
              select: {
                id: true,
                status: true,
                salary: true,
                currency: true,
                startDate: true,
                contractType: true,
                createdAt: true,
              },
            })
          : [],
        candidateIds.length
          ? db.assessmentAssignment.findMany({
              where: { candidateId: { in: candidateIds } },
              select: {
                id: true,
                status: true,
                assignedAt: true,
                completedAt: true,
                assessmentType: { select: { name: true } },
                // id + organizationId are selected for the §21 audit row below
                // (data_access_logs.recordId is @db.Uuid and organizationId is a
                // required scalar); they are the subject's own record keys, so
                // including them in the bundle is consistent with users/candidates.
                result: { select: { id: true, organizationId: true, normalizedScore: true } },
              },
            })
          : [],
        userIds.length
          ? // Deliberate carve-out: employee.prisma's "DOB never returned raw,
            // only age bands" rule governs ANALYTICS/dashboards. A Habeas-Data /
            // GDPR right-of-access export is the one channel where the subject is
            // entitled to their exact self-ID data, so raw dateOfBirth is correct here.
            db.employeeDemographics.findMany({
              where: { userId: { in: userIds } },
              // id + organizationId: see the §21 audit note on `result` above.
              select: {
                id: true,
                organizationId: true,
                gender: true,
                ethnicity: true,
                nationality: true,
                disabilityStatus: true,
                dateOfBirth: true,
              },
            })
          : [],
        userIds.length
          ? db.employeeCompensation.findMany({
              where: { userId: { in: userIds } },
              // id + organizationId: see the §21 audit note on `result` above.
              select: {
                id: true,
                organizationId: true,
                currentSalary: true,
                currency: true,
                effectiveDate: true,
              },
            })
          : [],
      ]);

      // §21 +AUDIT: one data_access_logs row per sensitive record actually exposed
      // by this bundle, keyed to that record's OWN organizationId, written BEFORE
      // the data is returned so a fail-closed audit failure aborts the export.
      // These three are exactly the CLASSIFICATION entities this surface reads at
      // confidential-or-above; `offer.salary` and `candidate` are unregistered
      // (dataClassOf → 'internal') and are covered by the data_subject_export
      // audit_logs row below.
      const auditActor = {
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        ipAddress: ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
        userAgent: ctx.headers.get('user-agent'),
      };
      const exposedResults = assessments.map((a) => a.result).filter((r): r is NonNullable<typeof r> => r !== null);
      await Promise.all([
        // restricted → fail-CLOSED (derived, not hardcoded).
        auditSensitiveRead(auditActor, 'employeeCompensation', compensation),
        // confidential → fail-SOFT.
        auditSensitiveRead(auditActor, 'employeeDemographics', demographics),
        // assessmentResult is restricted HEADLINE (raw psychometrics), but this
        // bundle exposes only `normalizedScore`, which is confidential — the mixed
        // -class override logDataAccess documents for exactly this table.
        auditSensitiveRead(auditActor, 'assessmentResult', exposedResults, { failClosed: false }),
      ]);

      const bundle = {
        subject: email,
        generatedAt: new Date().toISOString(),
        identity: { users, candidates },
        recruitment: { applications, interviews, offers, assessments },
        hr: { demographics, compensation },
      };

      // Audit the PII access: this is a cross-org, PII-bearing export (salary, DOB,
      // demographics). Write ONE record per affected org, keyed to the *matched
      // subjects'* real org ids — NOT ctx.user.organizationId, which is '' for an
      // org-less platform owner and would fail the required-UUID FK (silently, via
      // the .catch), leaving the export unaudited. Awaited (not fire-and-forget) so
      // the record durably lands before the serverless function can freeze; the
      // per-write .catch keeps a logging failure from blocking the right-of-access.
      const affectedOrgIds = [
        ...new Set([...users, ...candidates].map((r) => r.organizationId).filter((id): id is string => !!id)),
      ];
      // Fall back to the operator's own org so an org-less subject (User.organizationId
      // is nullable) is still audited under the platform owner's org. `''` (org-less
      // operator) is falsy and excluded.
      const auditOrgIds =
        affectedOrgIds.length > 0 ? affectedOrgIds : ctx.user.organizationId ? [ctx.user.organizationId] : [];
      const auditMeta = { email, matched: { users: users.length, candidates: candidates.length } };
      if (auditOrgIds.length > 0) {
        await Promise.all(
          auditOrgIds.map((organizationId) =>
            db.auditLog
              .create({
                data: {
                  organizationId,
                  actorId: ctx.user.id,
                  action: 'data_subject_export',
                  entity: 'data_subject',
                  entityId: email,
                  metadata: auditMeta,
                },
              })
              .catch(() => {}),
          ),
        );
      } else {
        // Doubly org-less (org-less operator exporting an org-less subject): no valid
        // AuditLog.organizationId exists, so record the access in the structured log
        // rather than let a PII export go completely unaudited.
        logger.warn(
          { action: 'data_subject_export', actorId: ctx.user.id, ...auditMeta },
          'PII data-subject export had no org context for auditLog — logged here instead',
        );
      }

      return {
        json: JSON.stringify(bundle, null, 2),
        counts: {
          users: users.length,
          candidates: candidates.length,
          applications: applications.length,
          interviews: interviews.length,
          offers: offers.length,
          assessments: assessments.length,
          demographics: demographics.length,
          compensation: compensation.length,
        },
      };
    }),
});
