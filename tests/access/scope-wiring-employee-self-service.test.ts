import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave (role rebuild) Slice 5B — static tripwires for the three OWN-scoped
// employee self-service reads. An employee sees ONLY their own data, never an
// org-wide rollup. These guards fail closed if a future edit widens scope.
//
//   engagement.myPendingSurveys → active surveys the caller has NOT responded to.
//                                 Org filter + anti-join on ctx.user.id. NO
//                                 requireOrgScope (would FORBID the own-scoped
//                                 caller). `survey` is not a scopeWhereFor entity
//                                 → hand-rolled org + anti-join filter.
//   compensation.myCompensation → CURRENT user's own comp via the existing
//                                 getEmployeeComp SERVICE path (field-auth +
//                                 audit preserved). Subject hard-pinned to
//                                 ctx.user.id — never an input userId.
//   consent.myConsents          → CURRENT user's DataConsent rows, subjectUserId
//                                 hard-pinned to ctx.user.id. protectedProcedure
//                                 (reading your own consent is inherently safe).

const ROOT = join(__dirname, '..', '..');
const readEngagement = () => readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');
const readCompensation = () => readFileSync(join(ROOT, 'packages/api/src/routers/compensation.ts'), 'utf8');
const readConsent = () => readFileSync(join(ROOT, 'packages/api/src/routers/consent.ts'), 'utf8');

// Isolate the body of a named procedure (`name: ...` up to the next top-level
// `procedure,` boundary) so assertions target THAT endpoint, not the whole file.
function procedureBody(src: string, name: string): string {
  const start = src.indexOf(`${name}:`);
  expect(start, `procedure ${name} not found`).toBeGreaterThanOrEqual(0);
  // Grab a generous slice; the next `\n  <name>:` sibling or end-of-file bounds it.
  const rest = src.slice(start + name.length);
  const next = rest.search(/\n {2}[a-zA-Z]+:\s*(permissionProcedure|protectedProcedure|router)/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

describe('engagement.myPendingSurveys — own-scoped survey anti-join', () => {
  const body = () => procedureBody(readEngagement(), 'myPendingSurveys');

  it('exists', () => {
    expect(readEngagement()).toMatch(/myPendingSurveys:/);
  });

  it('uses permissionProcedure(\'engagement\', \'read\') (employee has this grant)', () => {
    expect(body()).toMatch(/permissionProcedure\('engagement',\s*'read'\)/);
  });

  it('does NOT call requireOrgScope (own-scoped, not an org rollup)', () => {
    expect(body()).not.toMatch(/requireOrgScope/);
  });

  it('does NOT call scopeWhereFor (survey is not a scopeWhereFor entity)', () => {
    expect(body()).not.toMatch(/scopeWhereFor/);
  });

  it('filters by organizationId', () => {
    expect(body()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });

  it('anti-joins on ctx.user.id (responses none: userId)', () => {
    const b = body();
    expect(b).toMatch(/responses:\s*\{\s*none:\s*\{\s*userId:\s*ctx\.user\.id/);
  });

  it('uses an explicit select and a bounded take', () => {
    const b = body();
    expect(b).toMatch(/select:\s*\{/);
    expect(b).toMatch(/take:/);
  });
});

describe('compensation.myCompensation — own-pinned through the field-auth/audit service', () => {
  const body = () => procedureBody(readCompensation(), 'myCompensation');

  it('exists', () => {
    expect(readCompensation()).toMatch(/myCompensation:/);
  });

  it('uses permissionProcedure(\'compensation\', \'read\') (employee has this grant)', () => {
    expect(body()).toMatch(/permissionProcedure\('compensation',\s*'read'\)/);
  });

  it('does NOT call requireOrgScope (own-scoped, not an org rollup)', () => {
    expect(body()).not.toMatch(/requireOrgScope/);
  });

  it('takes NO userId input — the subject is hard-pinned to ctx.user.id', () => {
    const b = body();
    // No userId field declared in this procedure's input schema.
    expect(b).not.toMatch(/userId:\s*z\./);
    // The subject MUST be ctx.user.id (own), never an input.
    expect(b).toMatch(/ctx\.user\.id/);
    expect(b).not.toMatch(/input\.userId/);
  });

  it('routes through the existing getEmployeeComp field-auth/audit service path (not a raw db read)', () => {
    const b = body();
    // Must reuse the shared service helper that performs selectFor + logDataAccess.
    expect(b).toMatch(/getEmployeeCompForSubject|getEmployeeComp/);
    // It must NOT re-implement a raw employeeCompensation findFirst inside this body.
    expect(b).not.toMatch(/db\.employeeCompensation\.findFirst/);
  });
});

describe('consent.myConsents — own-pinned DataConsent read', () => {
  const src = () => readConsent();

  it('router file exists', () => {
    expect(() => readConsent()).not.toThrow();
  });

  it('myConsents exists and uses protectedProcedure', () => {
    const s = src();
    expect(s).toMatch(/myConsents:/);
    expect(s).toMatch(/protectedProcedure/);
  });

  it('does NOT call requireOrgScope', () => {
    expect(src()).not.toMatch(/requireOrgScope/);
  });

  it('takes NO userId input — subjectUserId is hard-pinned to ctx.user.id', () => {
    const s = src();
    expect(s).not.toMatch(/input\.userId/);
    expect(s).toMatch(/subjectUserId:\s*ctx\.user\.id/);
  });

  it('filters by organizationId', () => {
    expect(src()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });

  it('uses an explicit select (no full-row findMany)', () => {
    expect(src()).toMatch(/select:\s*\{/);
  });
});

describe('consent router is wired into the appRouter', () => {
  it('root.ts mounts the consent router', () => {
    const root = readFileSync(join(ROOT, 'packages/api/src/root.ts'), 'utf8');
    expect(root).toMatch(/consentRouter/);
    expect(root).toMatch(/consent:\s*consentRouter/);
  });
});
