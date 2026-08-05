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
 * WHAT THIS CAN AND CANNOT PROVE — stated plainly, and twice narrowed after cross-model review of PR #135
 * called the earlier versions overstated. Getting this description right is the point: a test file that
 * claims more enforcement than its assertions deliver is the very defect being fixed, in miniature.
 *
 *   - It CAN prove that the row numbered N has, as the first inline code span of its COMMAND CELL, a runner
 *     invoking the expected script (`npx tsx <path>` / `bash <path>`). That defeats the realistic drift:
 *     renumbering, a path demoted to a prose mention, a command swapped for `echo`, or a control deleted.
 *   - It CANNOT prove the row's surrounding prose does not negate the command — a cell whose command cell
 *     holds a valid invocation while the text beside it says "do not run this anymore" satisfies every
 *     assertion here. Distinguishing that needs reading comprehension, not a regex.
 *   - It CANNOT prove a human ran `/gate`, nor that the command is semantically correct. `/gate` is a
 *     markdown prompt executed by an agent, not a script with an exit code. **Review still carries that
 *     load.** What this file removes is the silent-drift class, not the need to read the diff.
 *   - It does NOT catch a NEW control added to `gate.md` and never declared here (`WIRED_CHECKS` covers only
 *     what it lists, and the no-gaps test is satisfied by 1..18). The enumeration forces declaring a script
 *     to be a deliberate act; it cannot force someone to make it.
 *
 * Rejected earlier versions, for the record: `gate.includes(script)` (a whole-file substring match, with the
 * check number in the test title but never asserted) and `codeSpans.some(...)` (any code span anywhere in
 * the row, so "use check 18 instead of `<path>`" passed).
 */

const ROOT = join(__dirname, '..', '..');
const GATE_REL = '.claude/commands/gate.md';
const gate = readFileSync(join(ROOT, GATE_REL), 'utf8');

/**
 * Every gate check that invokes a script: the number it must be wired as, and the runner that must invoke it.
 *
 * Enumerated rather than globbed over `scripts/**` deliberately — but see the header for what that does and
 * does not buy. It makes declaring a script a conscious act and keeps the declared set honest; it cannot
 * notice an undeclared new control.
 */
const WIRED_CHECKS: ReadonlyArray<{ check: number; script: string; runner: string; what: string }> = [
  {
    check: 14,
    script: 'scripts/security/verify-rls-isolation.ts',
    runner: 'npx tsx',
    what: 'RLS tenant isolation (#111)',
  },
  { check: 15, script: 'scripts/verification/crossmodel-review.sh', runner: 'bash', what: 'cross-model review (#38)' },
  { check: 16, script: 'scripts/db/schema-baseline.sh', runner: 'bash', what: 'schema drift vs baseline (#115)' },
  {
    check: 17,
    script: 'scripts/security/verify-tenant-grants.ts',
    runner: 'npx tsx',
    what: 'app_tenant least privilege (#126)',
  },
];

/** The checks that need live production database credentials — the three #124 blocks from CI. */
const LIVE_DB_CHECKS = [14, 16, 17] as const;

interface GateRow {
  check: number;
  row: string;
  /** The third cell — the Command column. */
  commandCell: string;
  /** Inline code spans inside the Command cell only. */
  commandSpans: string[];
}

/**
 * Rows look like: `| 17 | \`app_tenant\` grants (live DB) | \`npx tsx scripts/...\` → exit 0. ... |`
 *
 * Cells are split on pipes NOT preceded by a backslash, because the grep-based checks legitimately contain
 * escaped `\|` inside their commands. And the Command cell is addressed by POSITION rather than by "the
 * row's first code span": the Check cell also carries code spans (row 17's label contains `app_tenant`), so
 * "first span in the row" picked up a label and not a command. Found by this test failing on real data — the
 * reason to always watch a new assertion fail before trusting it.
 */
const GATE_ROWS: GateRow[] = [...gate.matchAll(/^\|\s*(\d+)\s*\|.*$/gm)].map((m) => {
  const cells = m[0].split(/(?<!\\)\|/);
  const commandCell = (cells[3] ?? '').trim();
  return {
    check: Number(m[1]),
    row: m[0],
    commandCell,
    commandSpans: [...commandCell.matchAll(/`([^`]+)`/g)].map((c) => c[1]),
  };
});

describe('/gate check list ↔ the scripts it must run', () => {
  it('the checks table parses at all', () => {
    // If the table format changes, every assertion below silently passes on an empty set. Fail loudly
    // instead — a test that cannot see its subject is the #38 defect in miniature.
    expect(
      GATE_ROWS.length,
      `parsed zero numbered rows from ${GATE_REL}. The table format changed, so this whole file is blind.`,
    ).toBeGreaterThan(10);
  });

  it.each(WIRED_CHECKS)("check $check ($what) invokes its script as the row's command", ({ check, script, runner }) => {
    const row = GATE_ROWS.find((r) => r.check === check);
    expect(row, `${GATE_REL} has no row numbered ${check}. Renumbering silently de-wires a control.`).toBeDefined();

    // Anchor to the FIRST code span of the COMMAND CELL — not "any code span in the row". That is what stops
    // a de-wiring note like "use check 18 instead of `<path>`" elsewhere in the row from satisfying this.
    const command = row!.commandSpans[0];
    expect(
      command,
      `${GATE_REL} row ${check}'s command cell has no inline code span — no command to run.\n` +
        `  command cell: ${row!.commandCell.slice(0, 200)}`,
    ).toBeDefined();

    // Require the runner too: a bare path is a mention, `npx tsx <path>` is an invocation.
    const expected = new RegExp(`^${runner}\\s+${script.replace(/[.]/g, '\\.')}(\\s|$)`);
    expect(
      expected.test(command!),
      `${GATE_REL} row ${check}'s command is not an invocation of ${script}.\n` +
        `  expected the command cell's first code span to start with: ${runner} ${script}\n` +
        `  actual first code span:                                    ${command}\n\n` +
        'The script must be invoked as the command of the row bearing its check number. A path named ' +
        'elsewhere in the file, under a different number, or without its runner, is not a wired check.',
    ).toBe(true);

    // And the cell must OPEN with that command. Without this, a cell reading
    //   "Do not run this anymore — use check 18 instead of `npx tsx <path>`."
    // satisfies everything above: its first code span is a perfectly valid invocation. Verified by
    // mutation that the assertion above alone passes that text and this one rejects it — which is why the
    // check exists as a separate expectation rather than a tightened regex.
    expect(
      row!.commandCell.startsWith(`\`${command}\``),
      `${GATE_REL} row ${check}'s command cell does not BEGIN with its command.\n` +
        `  command cell: ${row!.commandCell.slice(0, 200)}\n\n` +
        'Every real row opens with the command, then explains it. A cell that opens with prose and mentions ' +
        'the command later is documentation about the check, not an instruction to run it.',
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

  it('states in so many words that the live-DB checks have no CI equivalent', () => {
    // The trap this closes: reading a skipped check 14/16/17 as "CI will catch it". It will not.
    //
    // Tier-2 finding 2 on PR #135: this was `/no CI equivalent|#124/`, and that alternation defeated it —
    // `#124` already appears twice in the file for other reasons, so the actual sentence could be deleted
    // outright and the test still passed. Require the phrase itself. An alternation in a governance
    // assertion is almost always a hole: it passes on the weakest branch.
    expect(
      /no CI equivalent/.test(gate),
      `${GATE_REL} must state that checks ${LIVE_DB_CHECKS.join('/')} have no CI equivalent, so that ` +
        'skipping one is a visible decision rather than an assumption that CI covers it.',
    ).toBe(true);
  });

  it('attributes the live-DB credential blocker to 14/16/17 and NOT to check 15', () => {
    // Tier-2 finding 5 on PR #135: the first draft asserted the ABSENCE of a wrong sentence, via
    // `/checks? 14[–-]17[^.]*live database credentials/`. That was fragile in both directions — `[^.]*`
    // swallowed any negation, so a perfectly correct "checks 14-17 ... do not need live database
    // credentials" would have failed it, and it only passed at all because the committed wording happened
    // to read "live PRODUCTION database credentials". A wording accident, not an invariant.
    //
    // Pin the correct statement positively instead. Positive pins fail when the text stops saying the right
    // thing; negative pins fail when someone phrases the right thing an unanticipated way.
    expect(
      /\*\*14, 16, 17 need live production database credentials\*\*/.test(gate),
      `${GATE_REL} must attribute the live-database credential gap to checks 14, 16 and 17 specifically. ` +
        'Check 15 is the cross-model review — it needs an external reviewer (Codex/OmniRoute), not a ' +
        "database. Lumping 15 in makes #124 look bigger than it is and hides check 15's real blocker (#38).",
    ).toBe(true);

    expect(
      /\*\*15 needs an external reviewer\*\*/.test(gate),
      `${GATE_REL} must say check 15 needs an external reviewer, so its blocker is not confused with #124's.`,
    ).toBe(true);
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

  it('documents check 17 as exiting 2 on could-not-run', () => {
    // SUPERSEDED AND INVERTED, deliberately. On PR #135 this asserted the ABSENCE of a "same contract as 14
    // and 16" claim, because back then 17 returned 1 for both a violation and a could-not-run, so claiming
    // parity with 16 was false. #124 then ALIGNED 17 onto exit 2, which made the old assertion enforce a
    // now-false constraint — it would have blocked the accurate statement.
    //
    // Worth noting as a pattern: a test pinning a doc against a defect has to be revisited when the defect
    // is fixed, or it starts defending the defect. Pin the invariant, not the era.
    expect(
      /Exit 0 clean · 1 violation · 2 could-not-run/.test(governance),
      'ddl-governance.md must document check 17 as exit 0 clean / 1 violation / 2 could-not-run — the ' +
        'contract it now shares with check 16, and the one #124 needs in order to branch on it.',
    ).toBe(true);
  });
});
