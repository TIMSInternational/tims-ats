import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { logger } from '@tims/shared';
import { router } from '../../trpc';
import { clientIpFrom } from '../../lib/client-ip';
import { db, Prisma } from '@tims/db';
import { dataClassOf } from '../../access';
import { platformProcedure } from './_common';

// ---------------------------------------------------------------------------
// GDPR / Habeas Data (Ley 1581/2012) data-subject requests.
//
// exportSubjectData = the "right to access": bundle everything we hold about a
// person (matched by email across both the User/employee and Candidate sides)
// into a downloadable JSON. Proctoring metadata has explicit per-table caps
// because one assessment can produce many browser signals; a truncation marker
// makes any incomplete automated export visible for manual DSAR fulfillment.
// Platform-owner only. Deletion requests are handled manually for now (they
// carry legal-retention nuance + cascade risk) — a separate future capability.
// ---------------------------------------------------------------------------

const PROCTORING_CONSENT_LIMIT = 1_000;
const PROCTORING_SESSION_LIMIT = 1_000;
const PROCTORING_EVENT_LIMIT = 10_000;

/** Fetch one extra row to distinguish a complete page from a capped export. */
function boundedRows<T>(rows: ReadonlyArray<T>, limit: number): { data: T[]; truncated: boolean } {
  return { data: rows.slice(0, limit), truncated: rows.length > limit };
}

const RESTRICTED_AUDIT_BATCH_SIZE = 500;

// Compensation and the newly exported proctoring records are fail-CLOSED. A
// single transaction keeps the audit all-or-nothing even when the bounded event
// export needs multiple INSERT batches. Otherwise a late audit failure could
// leave append-only records claiming that a failed DSAR export had succeeded.
async function auditRestrictedExportReads(
  actor: { actorId: string; ipAddress: string | null; userAgent: string | null },
  records: ReadonlyArray<{ dataType: string; id: string; organizationId: string }>,
): Promise<void> {
  if (records.length === 0) return;
  try {
    await db.$transaction(async (tx) => {
      for (let offset = 0; offset < records.length; offset += RESTRICTED_AUDIT_BATCH_SIZE) {
        await tx.dataAccessLog.createMany({
          data: records.slice(offset, offset + RESTRICTED_AUDIT_BATCH_SIZE).map((record) => ({
            organizationId: record.organizationId,
            actorId: actor.actorId,
            dataType: record.dataType,
            recordId: record.id,
            action: 'export',
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
          })),
        });
      }
    }, { timeout: 30_000 });
  } catch (err) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'No se pudo registrar el acceso a datos restringidos; acceso abortado',
      cause: err,
    });
  }
}

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
      // err.message only — a PrismaClientValidationError serializes the whole
      // argument object, which carries the actor's ipAddress (personal data).
      { err: err instanceof Error ? err.message : String(err), entity, rows: rows.length, actorId: actor.actorId },
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
                // Used only to pair each assignment with its matched candidate's
                // organization before any privileged proctoring read. Stripped
                // from the legacy recruitment JSON shape below.
                candidateId: true,
                organizationId: true,
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

      const candidateOrgById = new Map(candidates.map((candidate) => [candidate.id, candidate.organizationId]));
      const assignmentIdsByOrg = new Map<string, string[]>();
      for (const assignment of assessments) {
        if (candidateOrgById.get(assignment.candidateId) !== assignment.organizationId) continue;
        const orgAssignments = assignmentIdsByOrg.get(assignment.organizationId) ?? [];
        orgAssignments.push(assignment.id);
        assignmentIdsByOrg.set(assignment.organizationId, orgAssignments);
      }
      const assignmentScopes = [...assignmentIdsByOrg].map(([organizationId, assignmentIds]) => ({
        organizationId,
        assignmentIds,
        candidateIds: candidates.filter((candidate) => candidate.organizationId === organizationId).map((candidate) => candidate.id),
      }));

      // This router intentionally uses the privileged client for cross-org
      // right-of-access exports. Every new proctoring query still requires BOTH
      // the matched subject's assignment ID and its organization ID. The database
      // limits are per export, not per assignment, and each query reads at most
      // one row beyond its documented cap so truncation cannot be silent.
      const [consentRows, sessionRows, eventRows] =
        assignmentScopes.length === 0
          ? [[], [], []] as const
          : await Promise.all([
              db.assessmentConsent.findMany({
                where: {
                  OR: assignmentScopes.map(({ organizationId, assignmentIds, candidateIds: scopedCandidateIds }) => ({
                    organizationId,
                    assignmentId: { in: assignmentIds },
                    candidateId: { in: scopedCandidateIds },
                  })),
                },
                orderBy: { id: 'asc' },
                take: PROCTORING_CONSENT_LIMIT + 1,
                select: {
                  id: true, organizationId: true, assignmentId: true, candidateId: true,
                  consentType: true, textVersion: true, agreedAt: true,
                  ipAddress: true, userAgent: true, createdAt: true, updatedAt: true,
                },
              }),
              db.proctoringSession.findMany({
                where: {
                  OR: assignmentScopes.map(({ organizationId, assignmentIds }) => ({
                    organizationId,
                    assignmentId: { in: assignmentIds },
                  })),
                },
                orderBy: { id: 'asc' },
                take: PROCTORING_SESSION_LIMIT + 1,
                select: {
                  id: true, organizationId: true, assignmentId: true,
                  startedAt: true, endedAt: true, flagCount: true, severity: true,
                  consentedAt: true, consentVersion: true, lastHeartbeatAt: true,
                  reviewStatus: true, reviewNotes: true, reviewedAt: true,
                  reviewedById: true, createdAt: true, updatedAt: true,
                  // The legacy `events` JSON is deliberately not selected. Old
                  // staff-written descriptions are unbounded free text; a
                  // parameterized boolean probe below flags manual DSAR access.
                },
              }),
              db.proctoringEvent.findMany({
                where: {
                  OR: assignmentScopes.map(({ organizationId, assignmentIds }) => ({
                    organizationId,
                    session: { is: { organizationId, assignmentId: { in: assignmentIds } } },
                  })),
                },
                orderBy: { id: 'asc' },
                take: PROCTORING_EVENT_LIMIT + 1,
                select: {
                  id: true, organizationId: true, sessionId: true, clientEventId: true,
                  type: true, source: true, severity: true, clientAt: true, occurredAt: true,
                },
              }),
            ]);
      const consents = boundedRows(consentRows, PROCTORING_CONSENT_LIMIT);
      const sessions = boundedRows(sessionRows, PROCTORING_SESSION_LIMIT);
      const events = boundedRows(eventRows, PROCTORING_EVENT_LIMIT);

      // Reading only a boolean avoids fetching a potentially huge legacy JSON
      // blob into the automated metadata export. Every checked session was
      // already selected using the candidate-assignment + organization scope.
      const legacyEventPresence = new Map<string, boolean>();
      for (const [organizationId, assignmentIds] of assignmentIdsByOrg) {
        const orgSessions = sessions.data.filter((session) =>
          session.organizationId === organizationId && assignmentIds.includes(session.assignmentId));
        if (orgSessions.length === 0) continue;
        const rows = await db.$queryRaw<Array<{ id: string; has_legacy_events: boolean }>>(Prisma.sql`
          SELECT id, events IS NOT NULL AND events <> '[]'::jsonb AS has_legacy_events
          FROM proctoring_sessions
          WHERE organization_id = ${organizationId}::uuid
            AND id IN (${Prisma.join(orgSessions.map((session) => Prisma.sql`${session.id}::uuid`))})
        `);
        for (const row of rows) legacyEventPresence.set(row.id, row.has_legacy_events);
      }
      // A missing probe result is an integrity error. It must never silently
      // imply that legacy content does not need manual review.
      if (sessions.data.some((session) => !legacyEventPresence.has(session.id))) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudo verificar el historial de proctoring' });
      }
      const proctoringSessions = sessions.data.map((session) => ({
        id: session.id,
        organizationId: session.organizationId,
        assignmentId: session.assignmentId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        flagCount: session.flagCount,
        severity: session.severity,
        consentedAt: session.consentedAt,
        consentVersion: session.consentVersion,
        lastHeartbeatAt: session.lastHeartbeatAt,
        reviewStatus: session.reviewStatus,
        reviewNotes: session.reviewNotes,
        reviewedAt: session.reviewedAt,
        reviewedById: session.reviewedById,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        legacyEventsManualAccessRequired: legacyEventPresence.get(session.id) === true,
      }));
      const proctoringTruncated = {
        assessmentConsents: consents.truncated,
        sessions: sessions.truncated,
        events: events.truncated,
      };
      const proctoringManualAccessRequired =
        Object.values(proctoringTruncated).some(Boolean)
        || proctoringSessions.some((session) => session.legacyEventsManualAccessRequired);
      const exportedAssessments = assessments.map(({ candidateId: _candidateId, organizationId: _organizationId, ...assessment }) => assessment);

      // §21 +AUDIT: one data_access_logs row per sensitive record actually exposed
      // by this bundle, keyed to that record's OWN organizationId, written BEFORE
      // the data is returned so a fail-closed audit failure aborts the export.
      // Compensation and proctoring metadata are audited fail-closed. Demographics
      // and assessment scores retain their existing fail-soft policies. `offer.salary`
      // and `candidate` are unregistered (dataClassOf → 'internal') and remain
      // covered by the data_subject_export audit_logs row below.
      const auditActor = {
        actorId: ctx.user.impersonatorId ?? ctx.user.id,
        // clientIpFrom, not the raw left-most x-forwarded-for: this is the one
        // forensic field §21 exists to produce, and the first XFF hop is
        // attacker-chosen. See the derivation note in trpc.ts.
        ipAddress: clientIpFrom(ctx.headers),
        userAgent: ctx.headers.get('user-agent'),
      };
      const exposedResults = assessments.map((a) => a.result).filter((r): r is NonNullable<typeof r> => r !== null);

      // All fail-CLOSED records go first, in one transaction. The fail-soft
      // writes below run only after that transaction commits successfully.
      await auditRestrictedExportReads(auditActor, [
        ...compensation.map((row) => ({ dataType: 'employeeCompensation', id: row.id, organizationId: row.organizationId })),
        ...consents.data.map((row) => ({ dataType: 'assessmentConsent', id: row.id, organizationId: row.organizationId })),
        ...proctoringSessions.map((row) => ({ dataType: 'proctoringSession', id: row.id, organizationId: row.organizationId })),
        ...events.data.map((row) => ({ dataType: 'proctoringEvent', id: row.id, organizationId: row.organizationId })),
      ]);
      await Promise.all([
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
        recruitment: { applications, interviews, offers, assessments: exportedAssessments },
        hr: { demographics, compensation },
        proctoring: {
          assessmentConsents: consents.data,
          sessions: proctoringSessions,
          events: events.data,
          truncated: proctoringTruncated,
          limits: {
            assessmentConsents: PROCTORING_CONSENT_LIMIT,
            sessions: PROCTORING_SESSION_LIMIT,
            events: PROCTORING_EVENT_LIMIT,
          },
          manualAccessRequired: proctoringManualAccessRequired,
          manualAccessNotice: proctoringManualAccessRequired
            ? 'La exportación automática está incompleta. Revise manualmente los registros truncados y los eventos heredados antes de cerrar esta solicitud de acceso.'
            : null,
          // True legacy free-text event JSON is intentionally excluded from the
          // automated bundle. A marked session requires manual access review to
          // fulfill the request completely; it must not be treated as complete.
          legacyEventsJsonIncluded: false,
        },
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
                  // Same actor derivation as the §21 rows above. It used to be a bare
                  // ctx.user.id, so under impersonation ONE export produced two audit
                  // rows naming two different actors — data_access_logs blaming the
                  // real operator and audit_logs blaming the impersonated user for an
                  // export they did not perform.
                  actorId: auditActor.actorId,
                  action: 'data_subject_export',
                  entity: 'data_subject',
                  entityId: email,
                  metadata: auditMeta,
                  // Columns exist on AuditLog and were simply never populated here.
                  ipAddress: auditActor.ipAddress,
                  userAgent: auditActor.userAgent,
                },
              })
              .catch(() => {}),
          ),
        );
      } else {
        // Doubly org-less (org-less operator exporting an org-less subject): no valid
        // AuditLog.organizationId exists, so record the access in the structured log
        // rather than let a PII export go completely unaudited.
        //
        // `auditMeta` is deliberately NOT spread in: it carries the data subject's
        // plaintext email, and CLAUDE.md bans PII in logs. The counts are the part
        // that has forensic value; the subject is identifiable from the audit_logs
        // row whenever one exists, and this branch is precisely the case where it
        // does not — so the subject stays out of the log rather than being written
        // to a sink with different retention and access controls than the audit
        // tables. (tests/security/pii-protection.test.ts only greps the console
        // logging idiom, so it does not catch the pino `logger.*` calls this
        // codebase actually uses — see the follow-up issue.)
        logger.warn(
          { action: 'data_subject_export', actorId: auditActor.actorId, matched: auditMeta.matched },
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
          proctoringConsents: consents.data.length,
          proctoringSessions: proctoringSessions.length,
          proctoringEvents: events.data.length,
        },
      };
    }),
});
