export const SCOPE_LADDER = ['own', 'team', 'unit', 'company', 'organization'] as const;
export type AccessScope = (typeof SCOPE_LADDER)[number];

export const isAccessScope = (s: string): s is AccessScope =>
  (SCOPE_LADDER as readonly string[]).includes(s);

export interface Grant {
  role: string;        // role slug that holds the grant
  module: string;
  action: string;
  scope: AccessScope;
}

export type AccessDecision =
  | { allowed: false }
  | { allowed: true; scope: AccessScope; roles: string[] };
