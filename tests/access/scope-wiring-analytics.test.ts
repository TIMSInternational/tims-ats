import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 3, codex F3 — recruitment-analytics aggregates are ORG-WIDE
// queries. Until they are scope-aware (follow-up in REMAINING-WORK), every
// procedure must fail closed for narrow-scoped callers via requireOrgScope.
// Slice 4 promotes requireOrgScope to a SHARED export in access/org-gate.ts and
// the analytics router consumes the shared one (no local copy).
const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const src = () => read('packages/api/src/routers/recruitment-analytics.ts');
const gate = () => read('packages/api/src/access/org-gate.ts');

describe('shared org-gate', () => {
  it('org-gate.ts defines the fail-closed requireOrgScope guard', () => {
    expect(gate()).toMatch(/export function requireOrgScope/);
    expect(gate()).toMatch(/FORBIDDEN/);
  });

  it('is re-exported from the access barrel', () => {
    expect(read('packages/api/src/access/index.ts')).toMatch(/requireOrgScope/);
  });
});

describe('recruitment-analytics org-scope gate', () => {
  it('imports the shared requireOrgScope from the access barrel (no local copy)', () => {
    expect(src()).toMatch(/requireOrgScope/);
    expect(src()).toMatch(/from\s+['"]\.\.\/access['"]/);
    // local copy deleted — no inline function definition remains
    expect(src()).not.toMatch(/function requireOrgScope/);
  });

  it('every procedure calls requireOrgScope before querying', () => {
    const procedures = (src().match(/permissionProcedure\(/g) ?? []).length;
    const guards = (src().match(/requireOrgScope\(ctx\.access\)/g) ?? []).length;
    expect(procedures).toBeGreaterThanOrEqual(6);
    expect(guards).toBe(procedures);
  });
});
