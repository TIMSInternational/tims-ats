export { db } from './client';
export type { PrismaClient } from '@prisma/client';
export {
  Prisma,
  OrgPlan,
  SubscriptionStatus,
  InvoiceStatus,
  InvitationType,
  InvitationStatus,
  Gender,
  Ethnicity,
  DisabilityStatus,
  QuestionType,
  AiInterviewStatus,
  AiAnalysisStatus,
  ReviewCycleStatus,
  RaterRelationship,
  RaterAssignmentStatus,
} from '@prisma/client';
// Tenant isolation (Postgres RLS). See docs/security/RLS-MIGRATION-PLAN.md.
export { tenantDb, runTenantTransaction, MissingTenantContextError } from './tenant-client';
export type { TenantDb } from './tenant-client';
export { runWithTenant, runUnscoped, getTenantOrgId, getUnscopedReason } from './tenant-context';
export { MATRIX, SYSTEM_ROLE_CATALOG, flattenEntries } from '../prisma/seed-access-matrix';
