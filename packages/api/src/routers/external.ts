import { z } from 'zod';
import { router, externalPermissionProcedure } from '../trpc';
import { externalAssessmentService, type ExternalAuditMeta } from '../services/external-assessment.service';

// `external` API surface (Wave 2.5 slice 7b). API-key-authenticated, read-only,
// org-scoped to the key's tenant. The key is the principal — NEVER accept it as
// input (requireApiKey reads the Authorization header). Endpoints require the
// 'assessment:read' role grant; a key may further narrow via its scopes[]
// ('assessment:read' as the requiredScope third arg).
const ASSESSMENT_READ = externalPermissionProcedure('assessment', 'read', 'assessment:read');

function auditMeta(ctx: {
  externalAuth?: { apiKeyId: string; organizationId: string; scopes: string[] } | null;
  headers: Headers;
}): ExternalAuditMeta {
  return {
    organizationId: ctx.externalAuth!.organizationId,
    apiKeyId: ctx.externalAuth!.apiKeyId,
    ipAddress: ctx.headers.get('x-forwarded-for') ?? ctx.headers.get('x-real-ip'),
    userAgent: ctx.headers.get('user-agent'),
  };
}

export const externalRouter = router({
  // Bulk sync of completed assessment profiles (cursor-paginated, full v1 payload).
  getAssessmentResults: ASSESSMENT_READ.input(
    z.object({
      take: z.number().int().min(1).max(25).default(25),
      cursor: z.string().uuid().optional(),
    }).optional(),
  ).query(({ ctx, input }) =>
    externalAssessmentService.list(ctx.access, auditMeta(ctx), input?.take ?? 25, input?.cursor),
  ),

  // Single assessment profile by assignment id (full v1 payload). NOT_FOUND if the
  // assignment is not in the key's org (IDOR-safe via RLS + scope).
  getAssessmentResult: ASSESSMENT_READ.input(
    z.object({ assignmentId: z.string().uuid() }),
  ).query(({ ctx, input }) =>
    externalAssessmentService.getOne(ctx.access, auditMeta(ctx), input.assignmentId),
  ),
});
