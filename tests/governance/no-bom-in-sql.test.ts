import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── No UTF-8 BOM in committed .sql ────────────────────────────────────────────
//
// `dotnet ef migrations script` emits a UTF-8 BOM. **psql rejects it outright** — the
// BOM bytes land before the first statement and the file fails to parse, so a DDL
// script that looks reviewed and correct simply will not apply.
//
// `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql` carried one from
// 2026-07-23 until #122. `docs/architecture/ddl-governance.md` §6 step 2 has warned
// about the BOM the whole time; the warning did not stop one being committed, which
// is the argument for a test rather than another sentence of prose.
//
// Scope is every committed `.sql`, not just the EF ones: the failure is a property of
// the bytes, not of which tool produced them.

const ROOT = join(__dirname, '../..');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'worktrees']);

function sqlFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // a broken symlink must not fail the sweep
    }
    if (st.isDirectory()) out.push(...sqlFilesUnder(p));
    else if (p.endsWith('.sql')) out.push(p);
  }
  return out;
}

describe('governance — committed .sql carries no UTF-8 BOM', () => {
  const files = sqlFilesUnder(ROOT);

  it('scans a non-empty population (non-vacuity)', () => {
    // A sweep over zero files is indistinguishable from a clean sweep. Establish the
    // denominator before trusting the numerator — the same discipline
    // scripts/db/pre-flip-repo-scan.mjs sets for itself.
    expect(files.length).toBeGreaterThan(20);
  });

  it('no .sql file starts with a UTF-8 BOM (psql rejects it)', () => {
    const offenders = files.filter((f) => readFileSync(f).subarray(0, 3).equals(BOM)).map((f) => relative(ROOT, f));
    expect(
      offenders,
      'psql rejects a leading UTF-8 BOM, so these DDL scripts would fail to apply. ' +
        'Strip it with `tail -c +4 file.sql > tmp && mv tmp file.sql`. `dotnet ef migrations script` ' +
        'emits one every time — see docs/architecture/ddl-governance.md §6 step 2.\nOffenders:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
