import { describe, it, expect } from 'vitest';
import { appRouter } from '@tims/api';

// THE SURVIVAL-RULE RATCHET — the executable form of "never build in packages/api again".
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// Phase 7 (#107) DELETES `packages/api` and `packages/db` outright. Every tRPC procedure added from
// 2026-08-31 onward therefore has to be written, characterized, C#-ported, parity-fixtured and then
// deleted — paid for twice, and the second payment is the expensive one.
//
// The rule ("build only where the code survives Phase 7 — the C# service, packages/ai, or apps/web")
// was a plan bullet and a memory note. Neither is enforceable, and this repo has a documented history
// of exactly that failure mode: `tests/governance/surveys-no-ts-writers.test.ts` exists because a
// "grep-verified, zero TS writers" claim survived three verifying greps across ten weeks for one
// reason — NOTHING EXECUTABLE PINNED IT. This file is that thing for the survival rule.
//
// ── WHY A RATCHET AND NOT A BAN ─────────────────────────────────────────────────────────────────
// Banning all edits to packages/api would be wrong: bug fixes, the deliberate TS-defect reproductions
// and the flip-PR edits are all legitimate and ongoing. What must never happen is the SURFACE growing.
// So this asserts a monotonically non-increasing count. Ports drive it down; nothing may drive it up.
// That makes it simultaneously a guard and the migration's own progress meter.
//
// ── WHY THE ROUTER AND NOT A GREP ───────────────────────────────────────────────────────────────
// Counted from `appRouter._def.procedures`, which is what tRPC actually registered — not a regex over
// source. This is load-bearing, not fastidiousness: on 2026-08-31 a hand-written regex over
// `packages/api/src/routers` returned 347 and the router returned 359. It missed twelve, including all
// three of `external.ts`'s, because they bind through a const (`const ASSESSMENT_READ =
// externalPermissionProcedure(...)`) rather than naming a procedure builder inline. A ratchet built on
// that regex would have had twelve procedures of silent headroom to grow into.
//
// ── WHEN THIS FAILS ─────────────────────────────────────────────────────────────────────────────
// Going UP: you added a tRPC procedure. Do not raise the baseline. Build it in the C# service
//   (`services/Tims.Platform`), in `packages/ai`, or in `apps/web` — the three trees that survive.
//   The C# service already carries every auth principal type, including the external API key.
// Going DOWN: a port deleted TypeScript. Correct and expected — LOWER the baseline in the same PR,
//   the same way the vitest anchor in `.claude/commands/gate.md` is re-pinned when it moves.
//
// Retire this file when `packages/api` is deleted in WP7.2 — at which point it stops compiling, which
// is the correct way for a tripwire to end.

/**
 * Measured 2026-08-31 at `7d1e6a94` + PR #249, exactly, from the router.
 * MAY ONLY EVER DECREASE.
 */
const PROCEDURE_CEILING = 359;

/**
 * The top-level routers registered in `packages/api/src/root.ts` on 2026-08-31.
 * Pinned as a SET, not a count: a ratchet on the total alone lets someone add a whole new router
 * while deleting procedures elsewhere and stay under the ceiling.
 */
const KNOWN_ROUTERS = new Set([
  'auth',
  'organization',
  'user',
  'vacancy',
  'pipeline',
  'candidate',
  'assessment',
  'interview',
  'offer',
  'onboarding',
  'performance',
  'learning',
  'engagement',
  'dei',
  'compensation',
  'monitoring',
  'integration',
  'audit',
  'billing',
  'featureFlag',
  'portal',
  'candidatePortal',
  'external',
  'consent',
  'notification',
  'platform',
  'aiInterview',
  'entitlement',
  'fitEngine',
]);

/**
 * Procedures alive in domains the cutover script reports as TS_DELETED or CONFIRMED_LIVE, which are
 * covered by NO port issue in #74–#101. Documented retentions (see the cutover notes for each), but
 * WP7.2 cannot delete `packages/api` while they exist and nothing schedules them. Pinned here so the
 * residue is visible in CI rather than only in a status report nobody re-derives.
 */
const UNSCHEDULED_RESIDUE: Record<string, number> = {
  audit: 5, // #102: "the tenant-scoped audit.ts router has no C# port at all"
  engagement: 4, // listSurveys + getRotationRisk + writes retained at the flip
  compensation: 4, // market-comparison + employee retained (zero FE consumers)
  billing: 3, // self-serve writes, blocked on the declined Stripe cutover (#62)
  dei: 1, // generateReport — never ported, deliberately retained
};

function procedurePaths(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (appRouter as any)._def;
  const paths = Object.keys(def.procedures);
  // Guard against a tRPC internals change silently emptying this and turning the whole file green.
  expect(paths.length).toBeGreaterThan(100);
  return paths;
}

describe('tRPC procedure ratchet — the survival rule, enforced', () => {
  it('the tRPC surface never grows', () => {
    const count = procedurePaths().length;

    expect(
      count,
      count > PROCEDURE_CEILING
        ? `The tRPC surface GREW to ${count} (ceiling ${PROCEDURE_CEILING}). packages/api is deleted by ` +
            `Phase 7 (#107), so a new procedure here is built twice. Build it in services/Tims.Platform, ` +
            `packages/ai, or apps/web instead. Do NOT raise this ceiling.`
        : '',
    ).toBeLessThanOrEqual(PROCEDURE_CEILING);
  });

  it('the ceiling is not stale — re-pin it when a port lands', () => {
    const count = procedurePaths().length;
    // A ceiling far above the real count is unenforceable, the same defect class as the stale vitest
    // anchor that sat at 3046 through eight merged PRs. Fail once a port has bought real headroom.
    expect(
      PROCEDURE_CEILING - count,
      `The surface is ${count} but the ceiling is ${PROCEDURE_CEILING}. A port has landed — lower ` +
        `PROCEDURE_CEILING to ${count} in that PR, or the ratchet stops enforcing anything.`,
    ).toBeLessThan(10);
  });

  it('no new top-level router appears', () => {
    const tops = new Set(procedurePaths().map((p) => p.split('.')[0]));
    const added = [...tops].filter((t) => !KNOWN_ROUTERS.has(t));

    expect(
      added,
      `New top-level tRPC router(s) registered in root.ts: ${added.join(', ')}. A whole new router is ` +
        `the survival rule's worst case — build it in the C# service.`,
    ).toEqual([]);
  });

  it('pins the residue that WP7.2 must still account for', () => {
    const byTop: Record<string, number> = {};
    for (const p of procedurePaths()) {
      const top = p.split('.')[0];
      byTop[top] = (byTop[top] ?? 0) + 1;
    }

    // These must shrink to zero before packages/api can be deleted. If one grows, a "migrated" domain
    // is being extended — the exact thing the survival rule forbids, in the least visible place.
    for (const [router, pinned] of Object.entries(UNSCHEDULED_RESIDUE)) {
      expect(
        byTop[router] ?? 0,
        `${router} has ${byTop[router] ?? 0} procedures, pinned at ${pinned}. It is reported as ` +
          `migrated by scripts/deploy/cutover.sh but is covered by no port issue. Growing it extends a ` +
          `domain that is supposed to be retiring; shrinking it is progress — re-pin lower.`,
      ).toBeLessThanOrEqual(pinned);
    }
  });
});
