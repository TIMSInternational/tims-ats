import { describe, it, expect } from 'vitest';
import { requireOrgScope } from '../../packages/api/src/access/org-gate';
import type { AccessContext } from '../../packages/api/src/access/types';

// Fix wave (CRITICAL scope-escalation fix), Sprint 1.7 Slice 2 — evaluation360 admin
// procedures used to be org-admin operations gated by requireOrgScope(ctx.access) as the
// first statement in every resolver (permissionProcedure only checks a grant EXISTS for
// module+action, it does NOT enforce scope). The TS evaluation360 router has since been
// deleted (C# cutover complete, NEXT_PUBLIC_EVALUATION360_READ/WRITE_VIA_CSHARP both true) —
// static source-text wiring assertions against that file no longer apply (see git history for
// the original router-wiring test if the C# equivalent ever needs auditing). What remains here
// is requireOrgScope's own behavior, which is still live production code shared across every
// TS router that calls it.

describe('requireOrgScope — behavioral (own/team/unit FORBIDDEN, company/organization pass)', () => {
  const ctxWith = (scope: AccessContext['scope']): AccessContext => ({
    allowed: true,
    scope,
    roles: ['employee'],
    anchors: null,
  });

  it.each(['own', 'team', 'unit'] as const)('throws FORBIDDEN for scope=%s', (scope) => {
    expect.assertions(1);
    try {
      requireOrgScope(ctxWith(scope));
    } catch (err) {
      expect((err as { code?: string }).code).toBe('FORBIDDEN');
    }
  });

  it.each(['company', 'organization'] as const)('does not throw for scope=%s', (scope) => {
    expect(() => requireOrgScope(ctxWith(scope))).not.toThrow();
  });
});
