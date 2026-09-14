/**
 * csv-builders-use-the-shared-helper.test.ts
 *
 * A repo-wide guard that every CSV builder routes through `csvCell`/`csvRow`
 * (`packages/shared/src/csv.ts`), which quote RFC-4180 and neutralize a leading `=`/`+`/`-`/`@`/TAB/CR
 * (CWE-1236 formula injection).
 *
 * WHY A GUARD RATHER THAN SIX INDIVIDUAL TESTS. The helper has existed since the audit-log export was
 * hardened, and six builders were still hand-rolling their own rows — four platform routers and two
 * frontend components. Each was invisible to the others: `tests/security/csv-export-hardening.test.ts`
 * unit-tests the HELPER, so it passes no matter how many callers ignore it, and its header even asserted
 * (falsely) that "there is no TS platform CSV export left to wire-test". A per-file test would have the
 * same blind spot as the thing it replaces — a NEW hand-rolled builder added tomorrow would be caught by
 * nothing. This test is written to fail on that.
 *
 * Tracked as GHSA-w6h5-g5gv-7g95. The invitations export was fixed first, in PR #220.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every file in the repo that builds a CSV. Adding a builder means adding it here. */
const CSV_BUILDERS = [
  'packages/api/src/routers/platform/invitations.ts',
  'packages/api/src/routers/platform/users.ts',
  'packages/api/src/routers/platform/invoices.ts',
  'packages/api/src/routers/platform/subscriptions.ts',
  'packages/api/src/routers/platform/ai-agents.ts',
  'apps/web/app/(admin)/platform/organizations/page.tsx',
  'apps/web/app/(admin)/platform/organizations/org-bulk-bar.tsx',
  'packages/api/src/services/audit.service.ts',
  'packages/api/src/services/candidate-pool.service.ts',
];

describe.each(CSV_BUILDERS)('%s', (path) => {
  const src = read(path);

  it('imports csvCell/csvRow from @tims/shared', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bcsv(Cell|Row)\b[^}]*\}\s*from\s*'@tims\/shared'/);
  });

});

describe('repo-wide: the hand-rolled shapes exist nowhere', () => {
  // This is the half that survives a stale list. The per-file block above only checks files someone
  // remembered to add; these three assertions are what catch a NEW hand-rolled builder added tomorrow,
  // anywhere in the repo. All three were verified to match nothing at the time this landed, so none of
  // them is vacuously green.
  // execFileSync with an ARGS ARRAY, never a shell string. Building the command with JSON.stringify
  // wrapped the pattern in DOUBLE quotes, so /bin/sh read the backtick in `"${x}"` as command
  // substitution — the grep then matched nearly the whole repo and died with ENOBUFS. No shell, no
  // quoting to get wrong.
  const grep = (pattern: string): string[] => {
    let out = '';
    try {
      out = execFileSync(
        'git',
        ['grep', '-nE', pattern, '--', 'packages/', 'apps/web/', 'workers/'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (e) {
      // git grep exits 1 when there are no matches, which is the passing case.
      const err = e as { status?: number; stdout?: string };
      if (err.status !== 1) throw e;
      out = err.stdout ?? '';
    }
    return out
      .split('\n')
      .filter(Boolean)
      // csv.ts IS the escaping implementation — it necessarily contains the shape it exists to provide.
      .filter((l) => !l.startsWith('packages/shared/src/csv.ts:'));
  };

  it("no row is built with [...].join(',')", () => {
    expect(grep("\\]\\s*\\.join\\(','\\)")).toEqual([]);
  });

  it('no CSV header is a bare comma-joined string literal', () => {
    expect(grep("const header = '[^']*,[^']*'")).toEqual([]);
  });

  it('no value is quoted by template interpolation without escaping', () => {
    // `` `"${x}"` `` looks like quoting but does not double an embedded quote — it breaks the row
    // outright for a value containing `"`. Both frontend builders did exactly this.
    expect(grep('`"\\$\\{[^}]+\\}"`')).toEqual([]);
  });

  it('no comma-stripping stands in for escaping', () => {
    // Mutates the data instead of escaping it: users.ts exported "Doe, Jane" as "Doe  Jane".
    expect(grep("replace\\(/,/g")).toEqual([]);
  });
});
