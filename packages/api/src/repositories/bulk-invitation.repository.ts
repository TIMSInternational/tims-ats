import { db, InvitationStatus, InvitationType } from '@tims/db';
import { ASSIGNABLE_STAFF_ROLES } from '@tims/shared';
import type { Prisma } from '@tims/db';

// Short DB work units leave time for the HTTP response; provider calls never run
// while a transaction/advisory lock is held.
function bounded<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
    return run(tx);
  }, { timeout: 2000, maxWait: 1000 });
}

export const bulkInvitationRepository = {
  findOrganization(organizationId: string) {
    return bounded(tx => tx.organization.findFirst({
      where: { id: organizationId, isActive: true, deletedAt: null }, select: { name: true },
    }));
  },
  createPending(input: {
    email: string; organizationId: string; organizationName: string; roleSlug?: string;
    token: string; invitedById: string; expiresAt: Date;
  }) {
    return bounded(async tx => {
      const key = `${input.organizationId.toLowerCase()}:${input.email.toLowerCase()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const existing = await tx.platformInvitation.findFirst({
        where: { organizationId: input.organizationId, email: { equals: input.email, mode: 'insensitive' },
          status: { in: [InvitationStatus.pending, InvitationStatus.sent, InvitationStatus.accepted] } },
        select: { id: true },
      });
      if (existing) return null;
      const roleSlug = input.roleSlug ?? 'employee';
      if (!ASSIGNABLE_STAFF_ROLES.some(role => role === roleSlug)) throw new Error('Role unavailable');
      const role = await tx.role.findFirst({
        where: { organizationId: input.organizationId, slug: roleSlug, isActive: true }, select: { id: true },
      });
      if (!role) throw new Error('Role unavailable');
      return tx.platformInvitation.create({
        data: { ...input, roleSlug, type: InvitationType.user, status: InvitationStatus.pending }, select: { id: true },
      });
    });
  },
  markSent(id: string, organizationId: string) {
    return bounded(tx => tx.platformInvitation.updateMany({
      where: { id, organizationId, status: InvitationStatus.pending },
      data: { status: InvitationStatus.sent, sentAt: new Date() },
    }));
  },
  findForResend(id: string) {
    return bounded(tx => tx.platformInvitation.findUnique({
      where: { id }, select: { id: true, email: true, token: true, status: true, organizationName: true, roleSlug: true },
    }));
  },
  markResent(id: string, expiresAt: Date) {
    return bounded(tx => tx.platformInvitation.updateMany({
      where: { id, status: { in: [InvitationStatus.pending, InvitationStatus.sent, InvitationStatus.expired] } },
      data: { status: InvitationStatus.sent, sentAt: new Date(), expiresAt },
    }));
  },
};
