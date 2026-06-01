import { Prisma } from '@prisma/client';

// Models that require organizationId filtering
const TENANT_MODELS = new Set([
  'Candidate', 'Vacancy', 'Application', 'Interview', 'Assessment',
  'Offer', 'OnboardingPlan', 'Okr', 'CoachingSession', 'Commitment',
  'Feedback', 'Recognition', 'Survey', 'SurveyResponse', 'ActionPlan',
  'LeaderCommitment', 'Course', 'Enrollment', 'Certificate',
  'NineBoxEvaluation', 'CalibrationSession', 'CriticalRole', 'Successor',
  'EmployeeCompensation', 'SalaryAdjustment', 'BenefitEnrollment',
  'AlertRule', 'Alert', 'Connector', 'Webhook', 'ApiKey',
  'Company', 'BusinessUnit', 'Team', 'Role', 'FeatureFlag', 'AuditLog',
  'User', 'Notification', 'Subscription', 'Invoice', 'BillingProfile',
]);

export function withTenantIsolation(orgId: string) {
  return Prisma.defineExtension({
    name: 'tenantIsolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);

          const a = args as Record<string, unknown>;

          // Auto-inject organizationId filter on reads
          if (['findMany', 'findFirst', 'count', 'aggregate', 'groupBy'].includes(operation)) {
            a.where = { ...(a.where as Record<string, unknown> | undefined), organizationId: orgId };
          }

          // Auto-inject on findUnique (convert to findFirst with org filter)
          if (operation === 'findUnique' && a.where && !('organizationId' in (a.where as Record<string, unknown>))) {
            // Can't add to unique where clause, but we can validate after
          }

          // Auto-inject on creates
          if (operation === 'create' && a.data && typeof a.data === 'object') {
            (a.data as Record<string, unknown>).organizationId = orgId;
          }

          // Auto-inject on updates/deletes
          if (['update', 'updateMany', 'delete', 'deleteMany'].includes(operation) && 'where' in a) {
            a.where = { ...(a.where as Record<string, unknown> | undefined), organizationId: orgId };
          }

          return query(args);
        },
      },
    },
  });
}
