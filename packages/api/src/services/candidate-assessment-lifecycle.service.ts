import { TRPCError } from '@trpc/server';
import { runWithTenant } from '@tims/db';
import type { Prisma } from '@tims/db';
import { candidateAssessmentRepo } from '../repositories/candidate-assessment.repository';
import { candidatePortalRepo } from '../repositories/candidate-portal.repository';
import { resolveOrg } from './candidate-portal.service';
import type { ScoreBand } from '@tims/shared';

// ---------------------------------------------------------------------------
// Candidate Assessment Lifecycle Service — list/start/questions, no db imports.
// The single-transaction submitAssessment write flow lives in
// candidate-assessment.service.ts (split per CLAUDE.md's 300-line service cap
// — these two files together back the same candidate-portal.ts router).
// ---------------------------------------------------------------------------

// Versioned Habeas-Data data-processing consent text identifier (non-repudiation
// record). The actual legal text lives in the Slice 3 FE i18n bundle; the server
// only needs a stable version id to prove which text the candidate agreed to.
//
// IMPORTANT: the copy in en.json/es.json's assessmentPlayer.consentBody and
// assessmentPlayer.consentCheckboxLabel is currently PLACEHOLDER TEXT pending
// legal review. This version id MUST be bumped (e.g. to 'habeas-data-assessment-v2')
// whenever that copy is replaced with the real legal text — otherwise every
// existing AssessmentConsent.textVersion='v1' record silently points at text that
// no longer exists, undermining the audit trail this mechanism exists for.
const HABEAS_DATA_CONSENT_VERSION = 'habeas-data-assessment-v1';

export function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

// AssessmentResult.breakdown is a Prisma Json? column shaped { autoScored, pendingManual }
// (see candidateAssessmentWriteRepo's upsertResultInTx caller in candidate-assessment.service.ts's
// submitAssessment) — but Json has no compile-time shape, so this is a runtime guard, never a cast to `any`.
function hasPendingManualReview(breakdown: Prisma.JsonValue | null | undefined): boolean {
  if (breakdown === null || breakdown === undefined || typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    return false;
  }
  const pendingManual = (breakdown as Record<string, unknown>).pendingManual;
  return Array.isArray(pendingManual) && pendingManual.length > 0;
}

interface AssignmentResultSummary {
  normalizedScore: number | null;
  percentile: number | null;
  band: ScoreBand | null;
  normSampleSize: number | null;
  breakdown: Prisma.JsonValue | null;
}

// Strips the internal `breakdown` JSON and replaces it with a derived `hasPending` boolean —
// the candidate-facing result screen (Wave 1.5a slice 3) must never receive raw breakdown JSON.
function withPendingFlag<T extends { result: AssignmentResultSummary | null }>(assignment: T) {
  const { result, ...rest } = assignment;
  if (!result) return { ...rest, result: null };
  const { breakdown, ...resultRest } = result;
  return { ...rest, result: { ...resultRest, hasPending: hasPendingManualReview(breakdown) } };
}

const STARTABLE_STATUSES = new Set(['assigned', 'in_progress']);

export const candidateAssessmentLifecycleService = {
  // An authenticated email with no Candidate record at this org is a valid
  // state (empty list, not an error) — matches getMyApplications.
  async getMyAssessments(email: string, orgSlug: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) return [];
      const assignments = await candidateAssessmentRepo.findAssignmentsForCandidate(org.id, candidate.id);
      return assignments.map(withPendingFlag);
    });
  },

  async startAssessment(
    email: string,
    orgSlug: string,
    assignmentId: string,
    consentAccepted: boolean,
    ipAddress: string | null,
    userAgent: string | null,
  ) {
    if (!consentAccepted) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'consent_required' });
    }
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      const assignment = await candidateAssessmentRepo.findOwnedAssignment(org.id, candidate.id, assignmentId);
      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      if (isExpired(assignment.expiresAt)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_expired' });
      }
      if (!STARTABLE_STATUSES.has(assignment.status)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_not_startable' });
      }

      // Idempotent: record consent on first start only (upsertConsent no-ops on
      // repeat), then (re)confirm in_progress either way.
      await candidateAssessmentRepo.upsertConsent({
        organizationId: org.id,
        assignmentId,
        candidateId: candidate.id,
        textVersion: HABEAS_DATA_CONSENT_VERSION,
        ipAddress,
        userAgent,
      });
      return candidateAssessmentRepo.markStarted(assignmentId);
    });
  },

  async getAssessmentQuestions(email: string, orgSlug: string, assignmentId: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      const assignment = await candidateAssessmentRepo.findOwnedAssignment(org.id, candidate.id, assignmentId);
      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      if (assignment.status !== 'in_progress') {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_not_in_progress' });
      }
      if (isExpired(assignment.expiresAt)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_expired' });
      }
      return candidateAssessmentRepo.findQuestionsForType(org.id, assignment.assessmentTypeId);
    });
  },
};
