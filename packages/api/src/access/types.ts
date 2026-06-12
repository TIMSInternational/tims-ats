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

/**
 * The shape requirePermission (trpc.ts) injects as `ctx.access`: an ALLOWED
 * decision (denied requests never reach the handler) plus the request-local
 * anchor loader (null only when there is no org context, i.e. platform paths).
 * Lives here (not index.ts) so sibling access modules can import it without
 * a barrel cycle.
 */
export type AccessContext = Extract<AccessDecision, { allowed: true }> & {
  anchors: import('./anchors').AnchorLoader | null;
};
