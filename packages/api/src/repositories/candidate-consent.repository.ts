import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
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
    const unique = [...new Set(candidateIds)];
    // #312: more than MAX_IDS ids are checked in bounded chunks — truncating would fail OPEN for the rest.
    if (unique.length > MAX_IDS) {
      const result = new Set<string>();
      for (let i = 0; i < unique.length; i += MAX_IDS) {
        for (const id of await this.withdrawnCandidateIds(organizationId, unique.slice(i, i + MAX_IDS))) result.add(id);
      }
      return result;
    }
    const ids = unique;
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

  /**
   * #312: EVERY candidate id of the org that counts as withdrawn — withdrawn on itself, or sharing a non-blank
   * lower(btrim(email)) (exact equality, never LIKE) with a candidate row that is. Used to HIDE existing
   * fit_scores rows on read surfaces in one query (`candidateId: { notIn: [...] }`). Withdrawals are rare, so the
   * set stays small; it is deliberately not capped (a cap would fail open).
   */
  async withdrawnCandidateIdsInOrg(organizationId: string): Promise<Set<string>> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT dc.subject_user_id::text AS id
        FROM data_consents dc
       WHERE dc.organization_id = ${organizationId}::uuid
         AND dc.consent_type = ${APPLICATION_CONSENT_TYPE}
         AND dc.withdrawn_at IS NOT NULL
      UNION
      SELECT c.id::text AS id
        FROM candidates c
       WHERE c.organization_id = ${organizationId}::uuid
         AND btrim(c.email) <> ''
         AND lower(btrim(c.email)) IN (
           SELECT lower(btrim(o.email))
             FROM candidates o
             JOIN data_consents dc ON dc.subject_user_id = o.id
            WHERE o.organization_id = ${organizationId}::uuid
              AND dc.organization_id = ${organizationId}::uuid
              AND dc.consent_type = ${APPLICATION_CONSENT_TYPE}
              AND dc.withdrawn_at IS NOT NULL
              AND btrim(o.email) <> '')`;
    return new Set(rows.map((r) => r.id));
  },

  /** #312: a FitScore filter that hides withdrawn candidates' rows ({} when nobody in the org withdrew). */
  async visibleFitScoreWhere(organizationId: string): Promise<Prisma.FitScoreWhereInput> {
    const withdrawn = await this.withdrawnCandidateIdsInOrg(organizationId);
    return withdrawn.size > 0 ? { candidateId: { notIn: [...withdrawn] } } : {};
  },

  async isRecruitmentConsentWithdrawn(organizationId: string, candidateId: string): Promise<boolean> {
    return (await this.withdrawnCandidateIds(organizationId, [candidateId])).size > 0;
  },
};
