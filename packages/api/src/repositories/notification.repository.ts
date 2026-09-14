import { Prisma } from '@prisma/client';
import { runTenantTransaction } from '@tims/db';

export class InvalidNotificationRecipientsError extends Error {
  constructor() { super('Invalid notification recipients'); }
}

export const notificationSelect = {
  id: true, type: true, title: true, message: true, module: true,
  read: true, readAt: true, entityType: true, entityId: true,
  actionUrl: true, createdAt: true,
} as const;

type Content = Pick<Prisma.NotificationUncheckedCreateInput,
  'type' | 'title' | 'message' | 'module' | 'entityType' | 'entityId' | 'actionUrl'>;

async function withRecipients<T>(organizationId: string | null | undefined, userIds: string[],
  write: (tx: Prisma.TransactionClient, orgId: string) => Promise<T>): Promise<T> {
  if (!organizationId) throw new InvalidNotificationRecipientsError();
  const distinctIds = [...new Set(userIds.map(id => id.toLowerCase()))];
  return runTenantTransaction(organizationId, async (tx) => {
    // Hold membership stable until the notification writes commit. FOR SHARE also
    // blocks non-key updates (deactivation, deletion and organization transfers).
    const targets = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM users WHERE organization_id = ${organizationId}::uuid
      AND id IN (${Prisma.join(distinctIds.map(id => Prisma.sql`${id}::uuid`))})
      AND is_active = true AND deleted_at IS NULL ORDER BY id FOR SHARE`);
    if (targets.length !== distinctIds.length) throw new InvalidNotificationRecipientsError();
    return write(tx, organizationId);
  });
}

export const notificationRepository = {
  create(organizationId: string | null | undefined, userId: string, content: Content) {
    return withRecipients(organizationId, [userId], (tx, orgId) => tx.notification.create({
      data: { ...content, userId, organizationId: orgId }, select: notificationSelect,
    }));
  },
  bulkCreate(organizationId: string | null | undefined, userIds: string[], content: Content) {
    return withRecipients(organizationId, userIds, (tx, orgId) => tx.notification.createMany({
      data: userIds.map(userId => ({ ...content, userId, organizationId: orgId })),
    }));
  },
};
