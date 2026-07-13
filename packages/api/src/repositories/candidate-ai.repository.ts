import { tenantDb as db } from '@tims/db';

// ---------------------------------------------------------------------------
// Candidate AI repository — the reads/writes the candidate AI service needs.
// Separate from candidate.repository to keep AI concerns isolated (rule #7).
// Explicit selects only — never return full records (CLAUDE.md §4).
// FitScore writes now live exclusively in fit-engine.repository.ts.
// ---------------------------------------------------------------------------

export const candidateAiRepository = {
  /** Minimal candidate profile for screening (no PII beyond what the agent needs). */
  async getCandidateProfile(orgId: string, candidateId: string) {
    return db.candidate.findFirst({
      where: { id: candidateId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        currentTitle: true,
        skills: true,
        yearsExperience: true,
      },
    });
  },

  /** Vacancy fields used to derive job requirements for screening. */
  async getVacancyForScreening(orgId: string, vacancyId: string) {
    return db.vacancy.findFirst({
      where: { id: vacancyId, organizationId: orgId, deletedAt: null },
      select: { id: true, title: true, description: true, settings: true },
    });
  },
};
