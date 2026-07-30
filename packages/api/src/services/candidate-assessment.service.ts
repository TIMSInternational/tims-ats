import { TRPCError } from '@trpc/server';
import { runWithTenant } from '@tims/db';
import { candidateAssessmentRepo } from '../repositories/candidate-assessment.repository';
import { candidatePortalRepo } from '../repositories/candidate-portal.repository';
import { resolveOrg } from './candidate-portal.service';

// Versioned Habeas-Data data-processing consent text identifier (non-repudiation
// record). The actual legal text lives in the Slice 3 FE i18n bundle; the server
// only needs a stable version id to prove which text the candidate agreed to.
const HABEAS_DATA_CONSENT_VERSION = 'habeas-data-assessment-v1';

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

const STARTABLE_STATUSES = new Set(['assigned', 'in_progress']);

export const candidateAssessmentService = {
  // An authenticated email with no Candidate record at this org is a valid
  // state (empty list, not an error) — matches getMyApplications.
  async getMyAssessments(email: string, orgSlug: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) return [];
      return candidateAssessmentRepo.findAssignmentsForCandidate(org.id, candidate.id);
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
