import { z } from 'zod';

export const sendBulkNotificationInput = z.object({
  organizationId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  type: z.enum(['info', 'warning', 'critical', 'success']),
});

export const getRecentPlatformEventsInput = z.object({
  limit: z.number().int().min(1).max(50).default(10),
});

export const getOrgAuditLogsInput = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const updateFeatureFlagInput = z.object({
  organizationId: z.string().uuid(),
  key: z.string().max(100),
  enabled: z.boolean(),
});

export const createFeatureFlagForAllOrgsInput = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_]+$/),
  enabled: z.boolean().default(false),
});

export const deleteFeatureFlagInput = z.object({ id: z.string().uuid() });

export const deleteFeatureFlagByKeyInput = z.object({ key: z.string().max(100) });
