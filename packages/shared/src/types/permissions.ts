export const MODULES = [
  'vacancy', 'pipeline', 'assessment', 'interview',
  'offer', 'candidate', 'onboarding', 'performance',
  'coaching', 'evaluation', 'commitment', 'ninebox',
  'talent', 'team', 'engagement', 'lnd',
  'compensation', 'monitoring', 'dei', 'organization',
  'billing', 'integration', 'audit', 'user',
] as const;

export type Module = typeof MODULES[number];

export const ACTIONS = ['create', 'read', 'update', 'delete', 'approve', 'export'] as const;
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
