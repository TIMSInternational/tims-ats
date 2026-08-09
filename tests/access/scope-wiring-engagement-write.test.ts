import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

// Phase-5 Slice 16 — static tripwires for the engagement WRITE surface + the H1 both-stacks
// hardening. Engagement's router calls the tenant `db` inline (no service layer), so — like the compensation /
// succession scope-wiring tripwires — behavior is guarded by source tripwires rather than a behavioral db mock.
//
// UPDATE 2026-07-29: the surface was 5 mutations. createSurvey / activateSurvey / submitSurveyResponse
// had their TS side DELETED (NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP is live in prod; C# is the sole
// implementation), and their 4 tripwires went with them. The equivalent guarantees — provenance
// stamping, cross-org 404, identity anchoring, P2002 → CONFLICT — are now asserted against the live
// C# API by scripts/parity/write-surfaces.ts's engagementSurface raw-SQL readbacks and by
// services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementWriteTests.cs.
//
// Write taxonomy (the 2 mutations that remain in TS — both zero-FE-consumer dead code, deliberately kept):
//   createActionPlan      → assertSubjectInScope(responsibleId) + H1 in-org backstop
//   updateActionPlan      → assertScoped('actionPlan') + (reassign → assertSubjectInScope + H1 in-org backstop)

const ROOT = join(__dirname, '..', '..');
const read = () => readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');

describe('engagement write scope wiring', () => {
  it('createActionPlan + updateActionPlan gate the target via assertSubjectInScope', () => {
    const src = read();
    const matches = src.match(/assertSubjectInScope/g) ?? [];
    // createActionPlan (always) + updateActionPlan (on reassignment).
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("updateActionPlan probes the plan by id via assertScoped('actionPlan')", () => {
    expect(read()).toMatch(/assertScoped\('actionPlan'/);
  });

  // ── Codex HIGH (both stacks): the assertScoped probe and the UPDATE are separate statements — a concurrent
  //    reassignment could move the plan out of the caller's narrow scope BETWEEN them. The UPDATE must therefore be
  //    scope-ATOMIC: re-apply scopeWhereFor('actionPlan') in the WHERE via updateMany (count 0 → 404), NOT a bare
  //    update-by-{id,org}. Reverting to `db.actionPlan.update({ where: { id, organizationId } })` makes this RED. ──
  it('updateActionPlan applies the scope predicate ATOMICALLY (updateMany guarded by scopeWhereFor, count 0 → 404)', () => {
    const src = read();
    const updateBody = blockAt(src, 'updateActionPlan:');
    // The final write is scoped updateMany, not a bare update by {id, organizationId}.
    expect(updateBody).toMatch(/scopeWhereFor\('actionPlan'/);
    expect(updateBody).toMatch(/actionPlan\.updateMany\(/);
    expect(updateBody).toMatch(/count\s*===\s*0[\s\S]*?code:\s*'NOT_FOUND'/);
    // A bare update-by-id would silently bypass the scope re-check — it must NOT be the write path.
    expect(updateBody).not.toMatch(/actionPlan\.update\(\{/);
    // Codex recheck: the read-back (findFirst) runs in a SEPARATE tenant txn, so it must ALSO apply scopeWhere —
    // else a between-txn reassignment could echo an out-of-scope row. Both where-clauses close with `scopeWhere]`.
    const scopedWheres = updateBody.match(/scopeWhere\]/g) ?? [];
    expect(scopedWheres.length).toBeGreaterThanOrEqual(2);
  });

  // ── H1 (both-stacks hardening): assertSubjectInScope no-ops for organization/company scope (write-rules.ts:20),
  //    so createActionPlan AND updateActionPlan(reassign) back it with an in-org existence check on responsibleId —
  //    a cross-org responsibleId is a cross-tenant integrity/enumeration hole. Neutralizing either guard (removing
  //    the `id: input.responsibleId, organizationId: ctx.user.organizationId` lookup) makes this tripwire RED. ──
  it('createActionPlan + updateActionPlan reject a cross-org responsibleId (in-org backstop → FORBIDDEN)', () => {
    const src = read();
    const guards = src.match(/id:\s*input\.responsibleId,\s*organizationId:\s*ctx\.user\.organizationId/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2); // one per mutation
    // Each guard forbids when the target is not in the caller's org.
    const forbids = src.match(/if \(!inOrg\) throw new TRPCError\(\{ code: 'FORBIDDEN'/g) ?? [];
    expect(forbids.length).toBeGreaterThanOrEqual(2);
  });
});
