import { db } from '@tims/db';
import { APPLICATION_CONSENT_TYPE } from '@tims/shared';

// Recruitment data-processing consent status (#312). A candidate who revoked the authorization
// (staff-recorded or self-service, both written by the C# consent surface) must receive no further
// processing. The privileged client with an EXPLICIT organization filter, not tenantDb: a suppression
// check must not silently read "not withdrawn" because a caller ran outside a tenant context (tenantDb
// with an unset org GUC sees no rows — it would fail OPEN here).
//
// The same person can exist as several candidate rows that differ only in email case/whitespace (legacy
// and staff-entered rows). A withdrawal recorded on ANY of them covers all of them, exactly like the
// public apply flow's check — so the lookup expands each id to every row of the org with the same
// normalized email.

const MAX_IDS = 500;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export const candidateConsentRepository = {
  /** The subset of `candidateIds` whose recruitment consent is withdrawn on that row or on any case variant. */
  async withdrawnCandidateIds(organizationId: string, candidateIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(candidateIds)].slice(0, MAX_IDS);
    if (ids.length === 0) return new Set();

    const requested = await db.candidate.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, email: true },
    });
    const emails = [...new Set(requested.map((c) => normalize(c.email)).filter((e) => e.length > 0))];
    // Exact case-insensitive equality (escaped, then post-filtered) — never a wildcard neighbour.
    const variants = emails.length
      ? (
          await db.candidate.findMany({
            where: {
              organizationId,
              OR: emails.map((e) => ({ email: { equals: escapeLikePattern(e), mode: 'insensitive' as const } })),
            },
            select: { id: true, email: true },
            take: emails.length * 20,
          })
        ).filter((v) => emails.includes(normalize(v.email)))
      : [];

    const allIds = [...new Set([...ids, ...variants.map((v) => v.id)])];
    const withdrawn = await db.dataConsent.findMany({
      where: {
        organizationId,
        subjectUserId: { in: allIds },
        consentType: APPLICATION_CONSENT_TYPE,
        withdrawnAt: { not: null },
      },
      select: { subjectUserId: true },
    });
    const withdrawnIds = new Set(withdrawn.map((w) => w.subjectUserId));
    const withdrawnEmails = new Set(
      [...requested, ...variants].filter((c) => withdrawnIds.has(c.id)).map((c) => normalize(c.email)),
    );
    return new Set(
      ids.filter((id) => {
        if (withdrawnIds.has(id)) return true;
        const row = requested.find((r) => r.id === id);
        return row !== undefined && withdrawnEmails.has(normalize(row.email));
      }),
    );
  },

  async isRecruitmentConsentWithdrawn(organizationId: string, candidateId: string): Promise<boolean> {
    return (await this.withdrawnCandidateIds(organizationId, [candidateId])).size > 0;
  },
};
