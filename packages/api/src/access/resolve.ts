import { SCOPE_LADDER, isAccessScope } from './types';
import type { AccessDecision, AccessScope, Grant } from './types';

/** Ladder max. Empty input floors to the narrowest scope ('own'). */
export function widestScope(scopes: AccessScope[]): AccessScope {
  let widestIdx = 0;
  for (const s of scopes) {
    const i = SCOPE_LADDER.indexOf(s);
    if (i > widestIdx) widestIdx = i;
  }
  return SCOPE_LADDER[widestIdx];
}

/** Deny-by-default. Stacking = union: widest scope wins, all contributing roles carried. */
export function resolveAccess(grants: Grant[], module: string, action: string): AccessDecision {
  const matching = grants.filter(
    (gr) => isAccessScope(gr.scope) && gr.module === module && gr.action === action,
  );
  if (matching.length === 0) return { allowed: false };
  return {
    allowed: true,
    scope: widestScope(matching.map((gr) => gr.scope)),
    roles: [...new Set(matching.map((gr) => gr.role))],
  };
}
