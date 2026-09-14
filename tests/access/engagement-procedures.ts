import { readFileSync } from 'fs';
import { join } from 'path';

// Shared helper for the engagement org-scope tripwires (#56, 2026-08-05).
//
// Both tests/access/scope-wiring-sensitive-data.test.ts and tests/access/scope-wiring-learning.test.ts
// used to assert `src.match(/requireOrgScope/g).length >= N` against packages/api/src/routers/
// engagement.ts. That is a COUNT — a snapshot of which procedures existed on a given date. It broke
// on every TS-deletion pass (9 → 5 → 3) and each repair re-pinned the new era instead of the rule,
// which meant the tripwire was defending a headcount rather than the guarantee.
//
// The guarantee is per-procedure: an engagement read that rolls up over respondents must carry the
// org-scope gate. Splitting the router into procedure blocks lets both tests assert exactly that,
// so they survive future deletions and still go red if a gate is removed or a new ungated aggregate
// read is added.

const ROOT = join(__dirname, '..', '..');
const ENGAGEMENT_ROUTER = join(ROOT, 'packages/api/src/routers/engagement.ts');

/** Top-level procedure declarations: two-space-indented `name: permissionProcedure(`. Prose in the
 *  file's disposition header is unindented `//` comment text and therefore never matches. */
const DECL = /^ {2}(\w+):\s*permissionProcedure\(/gm;

/** `{ procedureName: sourceOfThatProcedure }` for packages/api/src/routers/engagement.ts. */
export function engagementProcedureBlocks(): Record<string, string> {
  const src = readFileSync(ENGAGEMENT_ROUTER, 'utf8');
  const starts: Array<{ name: string; index: number }> = [];
  for (const m of src.matchAll(DECL)) starts.push({ name: m[1], index: m.index ?? 0 });

  const blocks: Record<string, string> = {};
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    blocks[s.name] = src.slice(s.index, end);
  });
  return blocks;
}

/**
 * The ONE documented exception to the org-scope gate, in BOTH stacks.
 *
 * `listSurveys` is grant-only by design: it returns a survey LIST whose only respondent-derived
 * column (`responseCount`) is min-5 floored per row before it leaves the router
 * (engagement.ts's `suppressBelowMin5` mapping), so there is no org-wide rollup to gate. The C#
 * port makes the same call — see the gating note in scripts/parity/surfaces.ts ("listSurveys:
 * grant-only (NO org-gate) → hrbp 200") and EngagementReadEndpoints.cs's `/engagement/surveys`.
 * Adding a name here is a deliberate, reviewable act; the tests assert every entry still exists.
 */
export const ENGAGEMENT_GRANT_ONLY = new Set<string>(['listSurveys']);
