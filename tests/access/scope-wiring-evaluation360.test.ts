import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { requireOrgScope } from '../../packages/api/src/access/org-gate';
import type { AccessContext } from '../../packages/api/src/access/types';

// Fix wave (CRITICAL scope-escalation fix), Sprint 1.7 Slice 2 — evaluation360
// admin procedures are org-admin operations (cycle CRUD + rater assignment).
// permissionProcedure('evaluation360', <action>) only checks a grant EXISTS
// for module+action — it does NOT enforce scope. Because 'employee' holds an
// own-scoped evaluation360 grant (seeded for slice 3/4's rater self-service),
// an employee could otherwise reach these org-admin endpoints — a privilege
// escalation. requireOrgScope(ctx.access) closes that gap.
//
// Test approach: this codebase has an established precedent for wiring
// checks on requireOrgScope — static source-text assertions (see
// scope-wiring-analytics.test.ts for recruitment-analytics, and
// ai-interview-router.test.ts for a router mixing static + mocked-service
// tests). There is NO existing precedent anywhere in tests/ for invoking a
// permissionProcedure-gated router endpoint via appRouter.createCaller with a
// mocked ctx.access — permissionProcedure's middleware chain resolves access
// via buildAccessForUser, which hits the DB (rolePermission grants), so a
// caller-level test would require mocking that DB call in addition to
// ctx.access, which no test in this repo currently does for a
// permissionProcedure router. Rather than inventing an unprecedented
// integration-test pattern for this fix wave, we:
//   1. follow the established static-wiring pattern (every admin procedure
//      calls requireOrgScope(ctx.access) as its first statement), AND
//   2. directly unit-test requireOrgScope's behavior for every scope on the
//      ladder, proving it throws FORBIDDEN for 'own'/'team'/'unit' and
//      passes for 'company'/'organization'.
// Together these cover: (a) the guard is wired into every admin procedure,
// and (b) the guard itself is behaviorally correct. The per-procedure,
// end-to-end "sub-org caller hits the admin endpoint and gets FORBIDDEN"
// path is exercised by the whole-branch review + live E2E per the build gate
// (.claude/rules/verification.md), not by a unit test here.

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const src = () => read('packages/api/src/routers/evaluation360.ts');

const ADMIN_PROCEDURES = [
  'createCycle',
  'openCycle',
  'closeCycle',
  'publishCycle',
  'assignRaters',
  'listCycles',
  'getCycleProgress',
] as const;

describe('evaluation360 router — org-gate wiring (static)', () => {
  it('imports the shared requireOrgScope from the access barrel', () => {
    expect(src()).toMatch(/requireOrgScope/);
    expect(src()).toMatch(/from\s+['"]\.\.\/access['"]/);
  });

  // Slice 3 added myRaterTasks/submitRatings — self-service, identity-anchored
  // procedures that deliberately do NOT call requireOrgScope (see
  // evaluation360-router-self-service.test.ts). So this check is scoped to
  // just the ADMIN_PROCEDURES set below, not "every permissionProcedure(
  // call in the file" (which would now also count the two self-service ones).
  it('every ADMIN permissionProcedure-gated procedure calls requireOrgScope(ctx.access)', () => {
    const body = src();
    const adminProceduresPresent = ADMIN_PROCEDURES.filter((p) =>
      new RegExp(`\\n {2}${p}: permissionProcedure\\(`).test(body),
    );
    const guards = (body.match(/requireOrgScope\(ctx\.access\)/g) ?? []).length;
    expect(adminProceduresPresent.length).toBe(ADMIN_PROCEDURES.length);
    expect(guards).toBe(ADMIN_PROCEDURES.length);
  });

  for (const proc of ADMIN_PROCEDURES) {
    it(`${proc}: requireOrgScope appears before the service call in its resolver body`, () => {
      const body = src();
      const start = body.indexOf(`${proc}:`);
      expect(start, `${proc} not found in router source`).toBeGreaterThanOrEqual(0);
      // Slice the resolver up to the next top-level procedure key (or EOF) so we
      // only look inside this procedure's own .mutation/.query callback.
      const nextKeys = ADMIN_PROCEDURES.filter((p) => p !== proc).map((p) => body.indexOf(`\n  ${p}:`, start + 1));
      const nextKeyIdx = Math.min(...nextKeys.filter((i) => i > start), body.length);
      const block = body.slice(start, nextKeyIdx);
      const guardIdx = block.indexOf('requireOrgScope(ctx.access)');
      const serviceIdx = block.search(/evaluation360Service\./);
      expect(guardIdx, `${proc} missing requireOrgScope`).toBeGreaterThanOrEqual(0);
      expect(serviceIdx, `${proc} missing evaluation360Service call`).toBeGreaterThanOrEqual(0);
      expect(guardIdx).toBeLessThan(serviceIdx);
    });
  }
});

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
