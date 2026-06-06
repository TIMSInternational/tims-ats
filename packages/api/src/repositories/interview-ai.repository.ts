import { tenantDb as db } from '@tims/db';

// ---------------------------------------------------------------------------
// Interview AI repository — minimal projections for the interview AI agents.
// Only the fields the prompts need (CLAUDE.md Prisma safety: explicit select).
// ---------------------------------------------------------------------------

export const interviewAiRepository = {
  /** Interview + scorecards + the vacancy/candidate context the agents need. */
  findInterviewForAi(orgId: string, interviewId: string) {
    return db.interview.findFirst({
      where: { id: interviewId, organizationId: orgId },
      select: {
        id: true,
        type: true,
        duration: true,
        candidate: { select: { firstName: true, lastName: true, currentTitle: true, skills: true } },
        vacancy: { select: { title: true, description: true } },
        scorecards: {
          select: {
            ratings: true,
            recommendation: true,
            overallNotes: true,
            evaluator: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
  },

  /**
   * Tenant-scoped write (IDOR defense-in-depth): the lookup includes
   * organizationId so a wrong orgId can never overwrite another tenant's
   * summary, even if a future caller skips the ownership pre-check.
   */
  async upsertSummary(
    orgId: string,
    interviewId: string,
    data: { summary: string; keyPoints: string[]; strengths: string[]; concerns: string[] },
    model: string,
  ) {
    const existing = await db.interviewSummary.findFirst({
      where: { interviewId, organizationId: orgId },
      select: { id: true },
    });
    const fields = {
      summary: data.summary,
      keyPoints: data.keyPoints,
      strengths: data.strengths,
      concerns: data.concerns,
      model,
    };
    if (existing) {
      return db.interviewSummary.update({
        where: { id: existing.id },
        data: { ...fields, generatedAt: new Date() },
      });
    }
    return db.interviewSummary.create({
      data: { organizationId: orgId, interviewId, ...fields },
    });
  },
};
