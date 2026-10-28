import 'server-only';
import { db } from '@tims/db';
import { APPLICATION_CONSENT_TYPE } from '@tims/shared';

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * #312: when the signed-in (email-confirmed) candidate revoked their recruitment consent at this organization, the
 * ISO time of the withdrawal, so the dashboard shows the persisted "revocada el …" state rather than the button.
 * Privileged read with explicit organization filters; exact case-insensitive email match (escaped, post-filtered),
 * every case variant, like the public apply flow.
 */
export async function findConsentWithdrawnAt(organizationId: string, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const candidates = (
    await db.candidate.findMany({
      where: { organizationId, email: { equals: escapeLikePattern(normalized), mode: 'insensitive' } },
      select: { id: true, email: true },
      take: 20,
    })
  ).filter((c) => c.email.trim().toLowerCase() === normalized);
  if (candidates.length === 0) return null;
  const consent = await db.dataConsent.findFirst({
    where: {
      organizationId,
      subjectUserId: { in: candidates.map((c) => c.id) },
      consentType: APPLICATION_CONSENT_TYPE,
      withdrawnAt: { not: null },
    },
    orderBy: { withdrawnAt: 'asc' },
    select: { withdrawnAt: true },
  });
  return consent?.withdrawnAt?.toISOString() ?? null;
}
