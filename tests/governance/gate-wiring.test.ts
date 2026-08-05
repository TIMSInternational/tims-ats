import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pin the `/gate` check list to the scripts it is supposed to run.
 *
 * WHY THIS EXISTS. `scripts/security/verify-tenant-grants.ts` ("check 17") shipped on 2026-08-04 as a
 * mandated control and was wired to nothing. The reason recorded in `ddl-governance.md` was that
 * "the `/gate` skill's own check list is defined outside this repository" — which was **false**. The list is
 * `.claude/commands/gate.md`, committed here, and PRs #114, #117 and #125 had each already edited that exact
 * file. Nobody ran `git ls-files` on it.
 *
 * That is the #38 failure mode with its polarity reversed. #38 was a gate everyone believed ran and did not.
 * This was a gate everyone knew did not run, held out by a blocker that did not exist. Both share one root
 * cause: **a claim about enforcement that no test could contradict.**
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated plainly, because the first draft of this file overstated it and a
 * cross-model reviewer was right to call that out (PR #135, tier-2 findings 1 and 2):
 *
 *   - It CAN prove that the row numbered N in the gate table invokes the expected script, as an inline code
 *     span rather than a passing mention in prose. That is what makes "check 17 runs verify-tenant-grants"
 *     a testable claim instead of a hopeful one.
 *   - It CANNOT prove a human actually ran `/gate`, or that the command in the row is semantically right.
 *     Nothing in a unit test can. `/gate` is a prompt executed by an agent, not a script with an exit code.
 *
 * The first draft asserted only `gate.includes(script)` — a bare substring match over the whole file, with
 * the check number carried in the test title but never asserted. That would have passed if the path had
 * drifted into a note reading "we no longer run verify-tenant-grants.ts", which is precisely the class of
 * silent de-wiring this file exists to catch.
 */

const ROOT = join(__dirname, '..', '..');
const GATE_REL = '.claude/commands/gate.md';
const gate = readFileSync(join(ROOT, GATE_REL), 'utf8');

/**
 * Every gate check that invokes a script, and the number it must be wired as.
 *
 * Enumerated explicitly rather than globbed over `scripts/**`: a glob would silently accept a NEW control
 * being added and never wired, which is the exact defect this pins. Adding a script here is the deliberate
 * act of declaring it part of the gate.
 */
const WIRED_CHECKS: ReadonlyArray<{ check: number; script: string; what: string }> = [
  { check: 14, script: 'scripts/security/verify-rls-isolation.ts', what: 'RLS tenant isolation (#111)' },
  { check: 15, script: 'scripts/verification/crossmodel-review.sh', what: 'cross-model review (#38)' },
  { check: 16, script: 'scripts/db/schema-baseline.sh', what: 'schema drift vs committed baseline (#115)' },
  { check: 17, script: 'scripts/security/verify-tenant-grants.ts', what: 'app_tenant least privilege (#126)' },
];

/** The checks that need live production database credentials — the three #124 blocks from CI. */
const LIVE_DB_CHECKS = [14, 16, 17] as const;

interface GateRow {
  check: number;
  row: string;
  /** Inline code spans within the row, i.e. the commands as opposed to the surrounding prose. */
  codeSpans: string[];
}

/** Rows look like: `| 17  | app_tenant grants (live DB) | \`npx tsx scripts/...\` → exit 0. ... |` */
const GATE_ROWS: GateRow[] = [...gate.matchAll(/^\|\s*(\d+)\s*\|(.*)$/gm)].map((m) => ({
  check: Number(m[1]),
  row: m[0],
  codeSpans: [...m[0].matchAll(/`([^`]+)`/g)].map((c) => c[1]),
}));

describe('/gate check list ↔ the scripts it must run', () => {
  it('the checks table parses at all', () => {
    // If the table format changes, every assertion below silently passes on an empty set. Fail loudly
    // instead — a test that cannot see its subject is the #38 defect in miniature.
    expect(
      GATE_ROWS.length,
      `parsed zero numbered rows from ${GATE_REL}. The table format changed, so this whole file is blind.`,
    ).toBeGreaterThan(10);
  });

  it.each(WIRED_CHECKS)('check $check ($what) is wired as check $check, not merely mentioned', ({ check, script }) => {
    const row = GATE_ROWS.find((r) => r.check === check);
    expect(row, `${GATE_REL} has no row numbered ${check}. Renumbering silently de-wires a control.`).toBeDefined();

    expect(
      row!.codeSpans.some((s) => s.includes(script)),
      `${GATE_REL} row ${check} does not invoke ${script} in an inline code span.\n` +
        `Row ${check} reads:\n  ${row!.row.slice(0, 300)}\n\n` +
        'The script must appear as a command (inside backticks) in the row bearing its check number — not ' +
        'anywhere in the file. A path mentioned in prose, or under a different number, is not a wired check.',
    ).toBe(true);
  });

  it.each(WIRED_CHECKS)('$script exists on disk', ({ script }) => {
    expect(
      existsSync(join(ROOT, script)),
      `${GATE_REL} references ${script}, but no such file exists. A gate pointing at a missing script fails ` +
        'as "command not found", which reads like an environment problem rather than a deleted control.',
    ).toBe(true);
  });

  it('check numbers are unique and the sequence has no gaps', () => {
    const numbers = GATE_ROWS.map((r) => r.check);
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    expect(duplicates, `duplicate check numbers in ${GATE_REL}: ${duplicates.join(', ')}`).toEqual([]);

    const sorted = [...numbers].sort((a, b) => a - b);
    const expected = Array.from({ length: sorted.length }, (_, i) => i + 1);
    expect(sorted, `check numbers must run 1..${sorted.length} with no gaps`).toEqual(expected);
  });

  it('states that the live-DB checks have no CI equivalent', () => {
    // The trap this closes: reading a skipped check 14/16/17 as "CI will catch it". It will not — #124 is
    // one credential decision blocking all three, and CI has no equivalent job.
    expect(
      /no CI equivalent|#124/.test(gate),
      `${GATE_REL} must state that checks ${LIVE_DB_CHECKS.join('/')} do not run in CI, so that skipping ` +
        'one is a visible decision rather than an assumption that CI covers it.',
    ).toBe(true);
  });

  it('does not describe check 15 as needing database credentials', () => {
    // Tier-2 finding 5 on PR #135: the first draft of the header lumped 15 in with "checks 14-17 need live
    // database credentials". Check 15 is the cross-model review — it needs an external reviewer (Codex or
    // OmniRoute), not a database. Blurring the two makes the real blocker (#124) look bigger than it is and
    // makes check 15's actual blocker (Codex quota / OmniRoute availability) invisible.
    expect(
      /checks?\s*14\s*[–-]\s*17\s*(have no CI equivalent)?[^.]*live database credentials/i.test(gate),
      `${GATE_REL} claims checks 14-17 need live database credentials. Check 15 does not — it is the ` +
        'cross-model review. Describe 14/16/17 (database) separately from 15 (external reviewer).',
    ).toBe(false);
  });
});

describe('ddl-governance.md stays truthful about check 17', () => {
  const governance = readFileSync(join(ROOT, 'docs/architecture/ddl-governance.md'), 'utf8');

  it('no longer claims the gate check list lives outside this repository', () => {
    // Kept as a literal so the false claim cannot creep back in. It is deliberately matched in its
    // assertive form, because the CORRECTED note above it quotes the sentence as history.
    expect(
      /check list is defined outside this repository\*\*, so adding/.test(governance),
      "ddl-governance.md asserts again that /gate's check list is outside this repo. It is not: " +
        `${GATE_REL} is tracked by git. Verify with \`git ls-files .claude/commands/\` before restoring this.`,
    ).toBe(false);
  });

  it('states the check 17 invariant as Prisma-owned OR RLS-protected', () => {
    // Guards the near-outage framing: "Prisma-owned only" implies revoking DML on RLS-protected EF tables,
    // which the C# strangler writes as app_tenant under TenantScope (TenantScope.cs:46).
    expect(
      /Prisma schema \*\*or\*\* protected\s*\n?by RLS|Prisma-owned or RLS-protected/.test(governance),
      'ddl-governance.md must state check 17 as "Prisma-owned OR RLS-protected". Stating it as ' +
        '"Prisma-owned only" is what nearly caused a production write outage in #126.',
    ).toBe(true);
  });

  it('does not claim check 17 shares check 16 exit codes', () => {
    // Tier-2 finding 3 on PR #135: "same contract as 14 and 16" read as an exit-code claim, contradicting
    // the note immediately below it. 16 uses exit 2 for could-not-run; 17 returns 1 for both. Same
    // fail-closed DOCTRINE, different exit codes — and a CI job can only branch on the latter (#124).
    expect(
      /same contract as 14 and 16/.test(governance),
      'ddl-governance.md says check 17 has "the same contract as 14 and 16". It does not: 16 distinguishes ' +
        'drift (1) from could-not-run (2), while 17 returns 1 for both. Say "same fail-closed doctrine".',
    ).toBe(false);
  });
});
