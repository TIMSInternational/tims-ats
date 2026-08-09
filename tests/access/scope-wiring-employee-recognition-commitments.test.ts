import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

// Wave (role rebuild) Slice 5C — static tripwires for the two OWN-scoped
// employee surfaces: recognition RECEIVED and the employee's own coaching
// commitments. An employee sees ONLY their own data, never an org-wide list.
// These guards fail closed if a future edit widens scope.
//
//   performance.myRecognitions → recognitions the caller RECEIVED. Hard-pinned to
//                                toUserId: ctx.user.id (NOT the enumerable
//                                listRecognitions({toUserId}) filter — an employee
//                                could pass another user's id there). Org filter +
//                                explicit select + bounded take. protectedProcedure
//                                (reading recognition given to YOU is safe).
//                                Recognition has NO isAnonymous flag (only Feedback
//                                does) → including the sender name is safe.
//   performance.myCommitments  → the employee's own Commitment rows via the
//                                registered `commitment` entity, AND-composed with
//                                organizationId (own → OR(employeeId=me,
//                                createdById=me)). NO requireOrgScope (would FORBID
//                                the own-scoped caller). Explicit select + bounded.

const ROOT = join(__dirname, '..', '..');
const readFeedback = () => readFileSync(join(ROOT, 'packages/api/src/routers/performance/feedback.ts'), 'utf8');
const readCoaching = () => readFileSync(join(ROOT, 'packages/api/src/routers/performance/coaching.ts'), 'utf8');

// Isolate the body of a named procedure (`name: ...` up to the next top-level
// `procedure,`/`router` boundary) so assertions target THAT endpoint.
describe('performance.myRecognitions — own-scoped recognition RECEIVED', () => {
  const body = () => blockAt(readFeedback(), 'myRecognitions:');

  it('exists', () => {
    expect(readFeedback()).toMatch(/myRecognitions:/);
  });

  it('uses protectedProcedure (reading recognition given to YOU is safe)', () => {
    expect(body()).toMatch(/protectedProcedure/);
  });

  it('does NOT call requireOrgScope (own-scoped, not an org rollup)', () => {
    expect(body()).not.toMatch(/requireOrgScope/);
  });

  it('takes NO userId input — the recipient is hard-pinned to ctx.user.id', () => {
    const b = body();
    // No userId field declared in this procedure's input schema.
    expect(b).not.toMatch(/userId:\s*z\./);
    expect(b).not.toMatch(/input\.userId/);
    expect(b).not.toMatch(/input\.toUserId/);
  });

  it('hard-pins the recipient: toUserId: ctx.user.id', () => {
    expect(body()).toMatch(/toUserId:\s*ctx\.user\.id/);
  });

  it('filters by organizationId', () => {
    expect(body()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });

  it('uses an explicit select and a bounded take', () => {
    const b = body();
    expect(b).toMatch(/select:\s*\{/);
    expect(b).toMatch(/take:/);
  });

  it('only exposes the sender display name (firstName/lastName), no fromUserId/email/avatar leak via select', () => {
    const b = body();
    expect(b).toMatch(/fromUser:\s*\{\s*select:\s*\{/);
  });
});

describe('performance.myCommitments — own-scoped employee commitments', () => {
  const body = () => blockAt(readCoaching(), 'myCommitments:');

  it('exists', () => {
    expect(readCoaching()).toMatch(/myCommitments:/);
  });

  it("uses permissionProcedure('performance', 'read') (employee has this grant)", () => {
    expect(body()).toMatch(/permissionProcedure\('performance',\s*'read'\)/);
  });

  it('does NOT call requireOrgScope (own-scoped, not an org rollup)', () => {
    expect(body()).not.toMatch(/requireOrgScope/);
  });

  it('takes NO userId/employeeId input — the subject resolves from ctx.access + ctx.user.id', () => {
    const b = body();
    expect(b).not.toMatch(/userId:\s*z\./);
    expect(b).not.toMatch(/employeeId:\s*z\./);
    expect(b).not.toMatch(/input\.employeeId/);
  });

  it("resolves the subject via scopeWhereFor('commitment', ctx.access, ctx.user.id)", () => {
    expect(body()).toMatch(/scopeWhereFor\(\s*'commitment',\s*ctx\.access,\s*ctx\.user\.id\s*\)/);
  });

  it('AND-composes the scope fragment with organizationId (never spreads it)', () => {
    const b = body();
    expect(b).toMatch(/AND:\s*\[/);
    expect(b).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
    // The fragment must be a discrete AND element, never spread (...scopeWhere).
    expect(b).not.toMatch(/\.\.\.scopeWhere/);
  });

  it('uses an explicit select and a bounded take', () => {
    const b = body();
    expect(b).toMatch(/select:\s*\{/);
    expect(b).toMatch(/take:/);
  });
});
