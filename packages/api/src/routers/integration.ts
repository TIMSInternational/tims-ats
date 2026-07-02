import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { randomBytes } from 'crypto';
import { hashApiKey } from '../lib/api-key';

// Webhook fields safe to return to clients — deliberately EXCLUDES `secret`
// (the HMAC signing secret) so it is never exposed via read/create/update.
const WEBHOOK_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  url: true,
  events: true,
  isActive: true,
  lastTriggeredAt: true,
  failureCount: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WebhookSelect;

// Connector fields safe to return to clients — deliberately EXCLUDES `config`
// (a Json blob that holds third-party integration credentials: API keys, OAuth
// tokens, connection strings). Secrets are written on create/update but never
// read back to any `integration:read` user.
const CONNECTOR_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  type: true,
  status: true,
  lastSyncAt: true,
  syncFrequency: true,
  entitiesSynced: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ConnectorSelect;

// Connector config is a credential-bearing blob; bound its size to prevent
// oversized-payload abuse (the values themselves are opaque to us).
const connectorConfigSchema = z
  .record(z.unknown())
  .refine((v) => JSON.stringify(v).length <= 10_000, 'config demasiado grande');

export const integrationRouter = router({
  // ── Connectors ──────────────────────────────────────────────

  listConnectors: permissionProcedure('integration', 'read').query(async ({ ctx }) => {
    return db.connector.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: {
        ...CONNECTOR_PUBLIC_SELECT,
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  getConnector: permissionProcedure('integration', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.connector.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: {
          ...CONNECTOR_PUBLIC_SELECT,
          creator: { select: { id: true, firstName: true, lastName: true } },
          syncs: { take: 10, orderBy: { startedAt: 'desc' } },
          errors: { where: { status: 'pending' }, take: 10, orderBy: { createdAt: 'desc' } },
        },
      });
    }),

  createConnector: permissionProcedure('integration', 'create')
    .input(
      z.object({
        name: z.string().min(1).max(100),
        type: z.string().min(1).max(100),
        config: connectorConfigSchema,
        syncFrequency: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.connector.create({
        data: {
          ...input,
          config: input.config as unknown as Prisma.JsonObject,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
        select: CONNECTOR_PUBLIC_SELECT,
      });
    }),

  updateConnector: permissionProcedure('integration', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        status: z.string().max(50).optional(),
        config: connectorConfigSchema.optional(),
        syncFrequency: z.string().max(100).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return db.connector.update({
        where: { id, organizationId: ctx.user.organizationId },
        data: {
          ...data,
          config: data.config as unknown as Prisma.JsonObject,
        },
        select: CONNECTOR_PUBLIC_SELECT,
      });
    }),

  deleteConnector: permissionProcedure('integration', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.connector.delete({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: { id: true },
      });
    }),

  syncNow: permissionProcedure('integration', 'update')
    .input(z.object({ connectorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Stub — enqueue sync job when worker is implemented
      await db.connectorSync.create({
        data: {
          organizationId: ctx.user.organizationId,
          connectorId: input.connectorId,
          status: 'queued',
        },
      });
      return { queued: true };
    }),

  getSyncHistory: permissionProcedure('integration', 'read')
    .input(
      z.object({
        connectorId: z.string().uuid(),
        take: z.number().min(1).max(100).default(20),
        cursor: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await db.connectorSync.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          connectorId: input.connectorId,
        },
        select: {
          id: true,
          connectorId: true,
          status: true,
          entitiesProcessed: true,
          duration: true,
          error: true,
          startedAt: true,
          completedAt: true,
        },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { startedAt: 'desc' },
      });
      const hasMore = items.length > input.take;
      return {
        items: items.slice(0, input.take),
        nextCursor: hasMore ? items[input.take - 1]!.id : undefined,
      };
    }),

  // Org-wide recent sync feed (across all connectors) for the activity panel.
  getRecentSyncs: permissionProcedure('integration', 'read')
    .input(z.object({ take: z.number().min(1).max(50).default(15) }).optional())
    .query(async ({ ctx, input }) => {
      return db.connectorSync.findMany({
        where: { organizationId: ctx.user.organizationId },
        select: {
          id: true,
          status: true,
          entitiesProcessed: true,
          duration: true,
          error: true,
          startedAt: true,
          completedAt: true,
          connector: { select: { name: true, type: true } },
        },
        take: input?.take ?? 15,
        orderBy: { startedAt: 'desc' },
      });
    }),

  // ── Webhooks ────────────────────────────────────────────────

  listWebhooks: permissionProcedure('integration', 'read').query(async ({ ctx }) => {
    return db.webhook.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: WEBHOOK_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }),

  createWebhook: permissionProcedure('integration', 'create')
    .input(
      z.object({
        url: z.string().url(),
        events: z.array(z.string().max(100)).max(100),
        secret: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.webhook.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
        select: WEBHOOK_PUBLIC_SELECT,
      });
    }),

  updateWebhook: permissionProcedure('integration', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        url: z.string().url().optional(),
        events: z.array(z.string().max(100)).max(100).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return db.webhook.update({
        where: { id, organizationId: ctx.user.organizationId },
        data,
        select: WEBHOOK_PUBLIC_SELECT,
      });
    }),

  deleteWebhook: permissionProcedure('integration', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.webhook.delete({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });
    }),

  // ── API Keys ────────────────────────────────────────────────

  listApiKeys: permissionProcedure('integration', 'read').query(async ({ ctx }) => {
    return db.apiKey.findMany({
      where: { organizationId: ctx.user.organizationId, revokedAt: null },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        environment: true,
        scopes: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  createApiKey: permissionProcedure('integration', 'create')
    .input(
      z.object({
        name: z.string().min(1).max(100),
        environment: z.enum(['production', 'staging', 'development']).default('production'),
        scopes: z.array(z.string().max(100)).max(20),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rawKey = `tims_${input.environment.slice(0, 4)}_${randomBytes(32).toString('hex')}`;
      const keyHash = hashApiKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12);

      await db.apiKey.create({
        data: {
          name: input.name,
          keyHash,
          keyPrefix,
          environment: input.environment,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
      });

      // Return the raw key only once — it cannot be retrieved later
      return { key: rawKey, prefix: keyPrefix };
    }),

  revokeApiKey: permissionProcedure('integration', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.apiKey.update({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        data: { revokedAt: new Date() },
      });
    }),

  // ── Error Log ───────────────────────────────────────────────

  getErrorLog: permissionProcedure('integration', 'read')
    .input(
      z.object({
        connectorId: z.string().uuid().optional(),
        status: z.string().max(50).optional(),
        take: z.number().min(1).max(100).default(20),
        cursor: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        organizationId: ctx.user.organizationId,
      };
      if (input.connectorId) where.connectorId = input.connectorId;
      if (input.status) where.status = input.status;

      const items = await db.syncError.findMany({
        where,
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: { connector: { select: { id: true, name: true, type: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const hasMore = items.length > input.take;
      return {
        items: items.slice(0, input.take),
        nextCursor: hasMore ? items[input.take - 1]!.id : undefined,
      };
    }),

  retryError: permissionProcedure('integration', 'update')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Stub — increment retry count and reset status
      return db.syncError.update({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        data: { status: 'retrying', retryCount: { increment: 1 } },
      });
    }),

  // ── System Health & KPIs ────────────────────────────────────

  getSystemHealth: permissionProcedure('integration', 'read').query(async () => {
    // Stub — return mock health data
    return {
      status: 'healthy',
      uptime: 99.97,
      latencyMs: 42,
      activeConnections: 3,
      services: {
        database: { status: 'healthy', latencyMs: 5 },
        redis: { status: 'healthy', latencyMs: 2 },
        storage: { status: 'healthy', latencyMs: 12 },
        email: { status: 'healthy', latencyMs: 85 },
      },
      lastCheckedAt: new Date().toISOString(),
    };
  }),

  getDashboardKpis: permissionProcedure('integration', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;

    const [connectorCount, activeWebhooks, pendingErrors, recentSyncs] =
      await Promise.all([
        db.connector.count({ where: { organizationId: orgId } }),
        db.webhook.count({ where: { organizationId: orgId, isActive: true } }),
        db.syncError.count({ where: { organizationId: orgId, status: 'pending' } }),
        db.connectorSync.count({
          where: {
            organizationId: orgId,
            startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    return { connectorCount, activeWebhooks, pendingErrors, recentSyncs };
  }),
});
