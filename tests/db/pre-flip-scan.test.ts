import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #132 — offline contract tests for `scripts/db/pre-flip-scan.ts`.
 *
 * WHY THESE ARE STATIC RATHER THAN EXECUTED. The script's real behaviour needs a live Postgres, and its
 * blocker paths WERE exercised against a throwaway PG17 cluster carrying a deliberate view and function
 * over a target table (both correctly reported as BLOCKERs, exit 1). That run cannot be committed —
 * `vitest` here has no database — so the runbook must not claim an automated test covers it. What IS
 * worth pinning automatically is the part that would rot silently: the exit-code contract and the
 * queries' correctness properties, each of which was a real finding.
 *
 * Same reasoning as `tests/db/schema-baseline-failure-paths.test.ts`: given #38, the properties a gate
 * depends on should fail loudly when edited away, even when the end-to-end path needs credentials.
 */

const ROOT = join(__dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'scripts/db/pre-flip-scan.ts'), 'utf8');

describe('pre-flip-scan — exit-code contract', () => {
  it('fails closed when no connection string is available', () => {
    // An unrunnable scan must never read as a clean scan (#38 doctrine, same as checks 14/16/17).
    expect(SRC).toMatch(/scan DID NOT RUN \(not a clean scan\)/);
    const idx = SRC.indexOf('scan DID NOT RUN');
    expect(SRC.slice(idx, idx + 200)).toMatch(/process\.exit\(1\)/);
  });

  it('exits 1 on a blocker and 0 only when the blocker list is empty', () => {
    expect(SRC).toMatch(/if \(blockers\.length === 0\)[\s\S]{0,900}?process\.exit\(0\)/);
    expect(SRC).toMatch(/database-side BLOCKER\(s\)[\s\S]{0,600}?process\.exit\(1\)/);
  });

  it('treats a missing table as a blocker rather than a clean result', () => {
    expect(SRC).toMatch(/if \(!r\.exists\) blockers\.push/);
  });

  it('classifies views AND functions as blockers, not merely as info', () => {
    expect(SRC).toMatch(/for \(const v of r\.dependentViews\) blockers\.push/);
    expect(SRC).toMatch(/for \(const f of r\.dependentRoutines\) blockers\.push/);
  });
});

describe('pre-flip-scan — query correctness properties (each was a real finding)', () => {
  it('matches table names on a word boundary, so `successors` cannot match a longer identifier', () => {
    expect(SRC).toMatch(/\\\\y\$\{t\}\\\\y/);
  });

  it('quotes the identifier in the existence probe, so a mixed-case table is not a false blocker', () => {
    // to_regclass('public.'||$1) folds unquoted names to lowercase, which reported
    // `__EFMigrationsHistory` as non-existent — a false BLOCKER. format('%I') quotes it.
    expect(SRC).toMatch(/to_regclass\(format\('public\.%I', \$1\)\)/);
    expect(SRC).not.toMatch(/to_regclass\('public\.'\|\|\$1\)/);
  });

  it('qualifies the FK join by constraint_schema, since constraint_name is not globally unique', () => {
    expect(SRC).toMatch(/kcu\.constraint_schema = tc\.constraint_schema/);
    expect(SRC).toMatch(/ccu\.constraint_schema = tc\.constraint_schema/);
  });

  it('excludes the scanned table itself from the "policies elsewhere referencing it" query', () => {
    expect(SRC).toMatch(/AND c\.relname <> \$2/);
  });

  it('does not let a failed db.end() mask the original connection error', () => {
    expect(SRC).toMatch(/db\.end\(\)\.catch\(\(\) => undefined\)/);
  });
});

describe('pre-flip-scan — --json is a machine interface', () => {
  it('emits nothing but JSON on stdout in --json mode, including on the clean path', () => {
    // The success summary must be gated, or piping to jq breaks precisely when there is no blocker.
    expect(SRC).toMatch(/if \(!asJson\) \{[\s\S]{0,400}?No database-side blocker/);
  });

  it('sends blocker output to stderr so it cannot corrupt the JSON payload', () => {
    const idx = SRC.indexOf('database-side BLOCKER(s)');
    expect(SRC.slice(Math.max(0, idx - 120), idx)).toMatch(/console\.error/);
  });
});
