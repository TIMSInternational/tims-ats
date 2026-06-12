import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 3, codex F3 — recruitment-analytics aggregates are ORG-WIDE
// queries. Until they are scope-aware (follow-up in REMAINING-WORK), every
// procedure must fail closed for narrow-scoped callers via requireOrgScope.
const ROOT = join(__dirname, '..', '..');
const src = () =>
  readFileSync(join(ROOT, 'packages/api/src/routers/recruitment-analytics.ts'), 'utf8');

describe('recruitment-analytics org-scope gate', () => {
  it('defines the fail-closed requireOrgScope guard', () => {
    expect(src()).toMatch(/function requireOrgScope/);
    expect(src()).toMatch(/FORBIDDEN/);
  });

  it('every procedure calls requireOrgScope before querying', () => {
    const procedures = (src().match(/permissionProcedure\(/g) ?? []).length;
    const guards = (src().match(/requireOrgScope\(ctx\.access\)/g) ?? []).length;
    expect(procedures).toBeGreaterThanOrEqual(6);
    expect(guards).toBe(procedures);
  });
});
