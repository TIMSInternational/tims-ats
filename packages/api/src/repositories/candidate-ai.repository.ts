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

  /**
   * Bounded, tenant-scoped set of this org's currently-open vacancies for the
   * candidate-matcher agent — the only valid recommendation targets. "Open"
   * mirrors vacancy/stats.ts's live-vacancy count (approved or published).
   */
  async getOpenVacanciesForMatching(orgId: string, limit: number) {
    return db.vacancy.findMany({
      where: { organizationId: orgId, status: { in: ['approved', 'published'] }, deletedAt: null },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true },
    });
  },
};
