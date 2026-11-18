import { tenantDb as db } from '@tims/db';

/** A proposed evaluator: whether they are active and the role slugs their session would carry. */
export type EvaluatorCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  roleSlugs: string[];
};

// Data access for the evaluator guard (services/interview-evaluator-eligibility.service.ts). Org-filtered, explicit selects.
export const interviewEvaluatorRepository = {
  /** The proposed evaluators that are users of this organization (an id from another tenant is simply absent). */
  async findCandidates(organizationId: string, userIds: readonly string[]): Promise<EvaluatorCandidate[]> {
    const rows = await db.user.findMany({
      where: { id: { in: [...userIds] }, organizationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isActive: true,
        userRoles: { select: { role: { select: { slug: true } } } },
      },
    });
    return rows.map(({ userRoles, ...user }) => ({ ...user, roleSlugs: userRoles.map((ur) => ur.role.slug) }));
  },

  /** The user ids on an interview's panel (its organization only). */
  async findPanelUserIds(organizationId: string, interviewId: string): Promise<string[]> {
    const rows = await db.interviewEvaluator.findMany({
      where: { interviewId, interview: { organizationId } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  },
};
