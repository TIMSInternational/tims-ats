import { randomUUID } from 'crypto';
import { getAppUrl } from '@tims/shared';
import { sendEmail } from '../lib/ses';
import { bulkInvitationRepository } from '../repositories/bulk-invitation.repository';
import { renderInvitationEmail } from './invitation-email';

type Invitee = { email: string; roleSlug?: string };
type InvitationResult = { email: string; status: 'sent' | 'duplicate' | 'error'; message?: string };

export async function bulkInviteUsers(organizationId: string, invitedById: string, users: Invitee[]) {
  // Best-effort synchronous delivery, not a durable job: stop starting work early
  // enough to finish in-flight DB operations and serialize before the 30s route cap.
  const deadline = Date.now() + 18_000;
  const org = await bulkInvitationRepository.findOrganization(organizationId);
  if (!org) return null;
  const seen = new Set<string>();
  const results: InvitationResult[] = new Array(users.length);
  let next = 0;
  async function worker() {
    while (next < users.length) {
      const index = next++;
      const user = users[index]!;
      const email = user.email.toLowerCase();
      if (seen.has(email)) {
        results[index] = { email: user.email, status: 'duplicate', message: 'Already invited' };
        continue;
      }
      if (deadline - Date.now() < 6_000) {
        results[index] = { email: user.email, status: 'error', message: 'Not attempted: request delivery budget exhausted' };
        continue;
      }
      seen.add(email);
      try {
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const invitation = await bulkInvitationRepository.createPending({
          email: user.email, organizationId, organizationName: org!.name,
          roleSlug: user.roleSlug, token, invitedById,
          expiresAt,
        });
        if (!invitation) {
          results[index] = { email: user.email, status: 'duplicate', message: 'Already invited' };
          continue;
        }
        const url = `${getAppUrl()}/accept-invitation?token=${encodeURIComponent(token)}`;
        const timeout = Math.min(4_000, deadline - Date.now() - 3_000);
        const delivered = timeout > 0 && await sendEmail({
          to: user.email,
          subject: `Invitacion para unirte a ${org!.name} en TIMS ATS`,
          html: renderInvitationEmail({ organization: org!.name, role: user.roleSlug, url, expiresAt }),
          abortSignal: AbortSignal.timeout(timeout),
        });
        if (!delivered) {
          results[index] = { email: user.email, status: 'error', message: 'Email delivery unconfirmed; invitation remains pending. Use resend.' };
          continue;
        }
        const updated = await bulkInvitationRepository.markSent(invitation.id, organizationId);
        results[index] = updated.count === 1
          ? { email: user.email, status: 'sent' }
          : { email: user.email, status: 'error', message: 'Invitation status changed during delivery' };
      } catch {
        results[index] = { email: user.email, status: 'error', message: 'Unable to complete invitation delivery; check pending invitations before retrying' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, users.length) }, () => worker()));
  return {
    results,
    summary: {
      total: users.length,
      sent: results.filter((r) => r.status === 'sent').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      errors: results.filter((r) => r.status === 'error').length,
    },
  };
}

export async function resendInvitation(id: string) {
  const invitation = await bulkInvitationRepository.findForResend(id);
  if (!invitation) return { error: 'not_found' } as const;
  if (invitation.status === 'accepted' || invitation.status === 'revoked') return { error: 'invalid_status' } as const;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const url = `${getAppUrl()}/accept-invitation?token=${encodeURIComponent(invitation.token)}`;
  const delivered = await sendEmail({
    to: invitation.email, subject: `Recordatorio: Invitacion pendiente - ${invitation.organizationName || 'TIMS ATS'}`,
    html: renderInvitationEmail({ organization: invitation.organizationName || 'TIMS ATS', role: invitation.roleSlug, url, expiresAt, reminder: true }),
    abortSignal: AbortSignal.timeout(4_000),
  });
  if (!delivered) return { error: 'delivery_failed' } as const;
  const updated = await bulkInvitationRepository.markResent(id, expiresAt);
  if (updated.count !== 1) return { error: 'invalid_status' } as const;
  return { id, status: 'sent' as const, sentAt: new Date(), expiresAt };
}
