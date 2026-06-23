import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Survey take/submit flow (feat/survey-take) — static tripwires for the NEW
// own-scoped read `engagement.getSurveyForResponse`. An employee holds
// `engagement:read@own`, so the endpoint must NOT use requireOrgScope (that
// would FORBID the own-scoped caller). `survey` is not a scopeWhereFor entity,
// so the org filter is hand-rolled, and eligibility (active + window) is gated
// in the where-clause. Explicit select, never the raw responseCount scalar.

const ROOT = join(__dirname, '..', '..');
const readEngagement = () => readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');

// Isolate the body of a named procedure up to the next sibling boundary.
function procedureBody(src: string, name: string): string {
  const start = src.indexOf(`${name}:`);
  expect(start, `procedure ${name} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + name.length);
  const next = rest.search(/\n {2}[a-zA-Z]+:\s*(permissionProcedure|protectedProcedure|router)/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

describe('engagement.getSurveyForResponse — own-scoped renderable survey read', () => {
  const body = () => procedureBody(readEngagement(), 'getSurveyForResponse');

  it('exists', () => {
    expect(readEngagement()).toMatch(/getSurveyForResponse:/);
  });

  it("uses permissionProcedure('engagement', 'read') (employee has this grant)", () => {
    expect(body()).toMatch(/permissionProcedure\('engagement',\s*'read'\)/);
  });

  it('does NOT call requireOrgScope (own-scoped read, not an org rollup)', () => {
    expect(body()).not.toMatch(/requireOrgScope/);
  });

  it('does NOT call scopeWhereFor (survey is not a scopeWhereFor entity)', () => {
    expect(body()).not.toMatch(/scopeWhereFor/);
  });

  it('filters by organizationId (hand-rolled org filter)', () => {
    expect(body()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });

  it("gates on status: 'active'", () => {
    expect(body()).toMatch(/status:\s*'active'/);
  });

  it('gates on the start/end window (startsAt lte now, endsAt gte now, null bounds open)', () => {
    const b = body();
    expect(b).toMatch(/startsAt:\s*null/);
    expect(b).toMatch(/startsAt:\s*\{\s*lte:/);
    expect(b).toMatch(/endsAt:\s*null/);
    expect(b).toMatch(/endsAt:\s*\{\s*gte:/);
  });

  it('takes a surveyId uuid input', () => {
    expect(body()).toMatch(/surveyId:\s*z\.string\(\)\.uuid\(\)/);
  });

  it('uses an explicit select of id/title/type/questions (no full-row read, no responseCount)', () => {
    const b = body();
    expect(b).toMatch(/select:\s*\{/);
    expect(b).toMatch(/id:\s*true/);
    expect(b).toMatch(/title:\s*true/);
    expect(b).toMatch(/type:\s*true/);
    expect(b).toMatch(/questions:\s*true/);
    // never leak the raw respondent head-count scalar
    expect(b).not.toMatch(/responseCount:\s*true/);
    // never expose other users' answers from this read
    expect(b).not.toMatch(/responses:\s*\{\s*select/);
  });

  it('throws NOT_FOUND when the survey is missing/ineligible', () => {
    expect(body()).toMatch(/NOT_FOUND/);
  });
});
