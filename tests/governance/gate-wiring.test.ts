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
 * So the invariant here is narrow and mechanical, and deliberately not a judgement call: a live-DB check
 * script that exists in this repo must be NAMED in the gate's check list, and every script the gate names
 * must exist. It cannot verify that a human ran `/gate` — nothing in a unit test can — but it does make
 * "the script exists but nothing invokes it" a red build instead of a line in a checkpoint file.
 *
 * These four are enumerated explicitly rather than globbed. A glob over `scripts/**` would silently accept
 * a new privilege check being added and never wired, which is the precise defect this pins.
 */

const ROOT = join(__dirname, '..', '..');
const GATE_REL = '.claude/commands/gate.md';
const gate = readFileSync(join(ROOT, GATE_REL), 'utf8');

/** Every check `/gate` must invoke that talks to a live database, with the check number it is wired as. */
const LIVE_DB_CHECKS: ReadonlyArray<{ check: number; script: string; what: string }> = [
  { check: 14, script: 'scripts/security/verify-rls-isolation.ts', what: 'RLS tenant isolation (#111)' },
  { check: 16, script: 'scripts/db/schema-baseline.sh', what: 'schema drift vs committed baseline (#115)' },
  { check: 17, script: 'scripts/security/verify-tenant-grants.ts', what: 'app_tenant least privilege (#126)' },
];

/** Non-DB gate scripts whose wiring is equally load-bearing. */
const OTHER_WIRED_SCRIPTS: readonly string[] = ['scripts/verification/crossmodel-review.sh'];

describe('/gate check list ↔ the scripts it must run', () => {
  it.each(LIVE_DB_CHECKS)('check $check ($what) is named in the gate list', ({ script }) => {
    expect(
      gate.includes(script),
      `${GATE_REL} does not mention ${script}.\n` +
        'A live-DB control that /gate does not name is a control that never runs: CI cannot run these ' +
        '(no prod credentials — #124), so /gate is the ONLY place they execute. Add it to the check table.',
    ).toBe(true);
  });

  it.each([...LIVE_DB_CHECKS.map((c) => c.script), ...OTHER_WIRED_SCRIPTS])('%s exists on disk', (script) => {
    expect(
      existsSync(join(ROOT, script)),
      `${GATE_REL} references ${script}, but no such file exists. A gate pointing at a missing script ` +
        'fails as "command not found", which reads like an environment problem rather than a deleted control.',
    ).toBe(true);
  });

  it('every check number in the table is unique and the sequence has no gaps', () => {
    // Rows look like: `| 17  | app_tenant grants (live DB) | ...`
    const numbers = [...gate.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
    expect(
      numbers.length,
      'parsed zero check rows — the table format changed, so this test is now blind',
    ).toBeGreaterThan(10);

    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    expect(duplicates, `duplicate check numbers in ${GATE_REL}: ${duplicates.join(', ')}`).toEqual([]);

    const sorted = [...numbers].sort((a, b) => a - b);
    const expected = Array.from({ length: sorted.length }, (_, i) => i + 1);
    expect(sorted, `check numbers must run 1..${sorted.length} with no gaps`).toEqual(expected);
  });

  it('the live-DB checks are documented as having no CI equivalent', () => {
    // The trap this closes: reading a skipped check 14/16/17 as "CI will catch it". It will not.
    expect(
      /no CI equivalent|local-only|#124/.test(gate),
      `${GATE_REL} must state that checks 14-17 do not run in CI, so that skipping one is a visible ` +
        'decision rather than an assumption that CI covers it.',
    ).toBe(true);
  });
});

describe('ddl-governance.md enforcement table stays truthful about check 17', () => {
  const governance = readFileSync(join(ROOT, 'docs/architecture/ddl-governance.md'), 'utf8');

  it('no longer claims the gate check list lives outside this repository', () => {
    // The exact false sentence, kept as a literal so it cannot creep back in. Note it is quoted in the
    // CORRECTED note above it as history; that quote is why this matches on the claim's assertive form.
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
});
