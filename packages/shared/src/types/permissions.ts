// Permission modules, grouped by ATS lifecycle phase (sourcing → interviews → post-offer → talent → culture → admin).
// Must stay a superset of every module used in seed-access-matrix.ts (enforced by tests/access/permission-vocabulary.test.ts).
export const MODULES = [
  'vacancy', 'pipeline', 'candidate', 'assessment',
  'interview', 'offer', 'onboarding', 'performance',
  'learning', 'ninebox', 'succession', 'team_intel',
  'engagement', 'dei', 'compensation', 'monitoring',
  'organization', 'user', 'notification', 'audit',
  'feature_flags', 'billing', 'integration', 'fit_engine',
] as const;

export type Module = typeof MODULES[number];

export const ACTIONS = ['create', 'read', 'update', 'delete', 'approve', 'export', 'publish'] as const;
export type Action = typeof ACTIONS[number];

export const SCOPES = ['own', 'team', 'unit', 'company', 'organization'] as const;
export type Scope = typeof SCOPES[number];

export interface Permission {
  module: Module;
  action: Action;
  scope: Scope;
}

export interface PermissionCheck {
  module: Module;
  action: Action;
  resourceOrgId?: string;
  resourceCompanyId?: string;
  resourceUnitId?: string;
  resourceTeamId?: string;
}
