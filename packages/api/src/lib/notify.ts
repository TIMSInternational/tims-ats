import { db } from '@tims/db';

interface NotifyParams {
  userId?: string;
  userIds?: string[];
  organizationId?: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  message?: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
}

export async function notify(params: NotifyParams) {
  const targets = params.userIds ? [...params.userIds] : params.userId ? [params.userId] : [];

  if (targets.length === 0 && params.organizationId) {
    // Notify all platform owners
    const owners = await db.user.findMany({
      where: { isPlatformOwner: true },
      select: { id: true },
    });
    targets.push(...owners.map((o) => o.id));
  }

  if (targets.length === 0) return;

  await db.notification.createMany({
    data: targets.map((userId) => ({
      userId,
      organizationId: params.organizationId || null,
      type: params.type,
      title: params.title,
      message: params.message,
      module: params.module,
      entityType: params.entityType,
      entityId: params.entityId,
      actionUrl: params.actionUrl,
    })),
  });
}
