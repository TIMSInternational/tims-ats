import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 4 — static tripwires for the onboarding module. Every
// row-level read composes the scope fragment via AND; planId endpoints probe
// via assertScoped; taskId/checkIn-id endpoints fetch-then-probe via parent
// plan; create gates the new-hire target via assertSubjectInScope;
// getDashboardKpis gates via requireOrgScope. Fragment behavior covered by
// tests/access/entity-policies.test.ts and write-rules.test.ts.
const ROOT = join(__dirname, '..', '..');
const src = readFileSync(
  join(ROOT, 'packages/api/src/routers/onboarding.ts'),
  'utf8',
);

describe('onboarding module scope wiring', () => {
  it('list and getById compose the onboardingPlan fragment via AND', () => {
    expect(src).toMatch(/scopeWhereFor\('onboardingPlan'/);
    expect(src).toMatch(/AND:\s*\[/);
  });

  it('has at least 3 assertScoped calls for onboardingPlan', () => {
    const hits = src.match(/assertScoped\('onboardingPlan'/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it('create gates the new-hire target via assertSubjectInScope', () => {
    expect(src).toMatch(/assertSubjectInScope/);
  });

  it('getDashboardKpis gates via requireOrgScope', () => {
    expect(src).toMatch(/requireOrgScope/);
  });

  it('no file spreads a scope fragment (AND-composition, CI check 13)', () => {
    expect(src).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });
});
