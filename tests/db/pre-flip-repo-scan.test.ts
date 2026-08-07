import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_ROOTS, nameVariants, scanDataFiles } from '../../scripts/db/pre-flip-repo-scan.mjs';

/**
 * #132 — the DATA-DRIVEN reader arm of `scripts/db/pre-flip-scan.ts`, tested for real.
 *
 * WHY THIS FILE IS EXECUTED AND NOT A SOURCE-TEXT PIN. The database arms of the pre-flip scan cannot run
 * under `npx vitest run` (no database), so they are pinned by their properties in
 * `tests/db/pre-flip-scan.test.ts`. This arm has no such excuse: it reads files. So it is split into a
 * pure module and exercised against the REAL repository, including the exact break that produced #132.
 *
 * THE BREAK BEING PINNED. Flip #2 removed `'successor'` / `'criticalRole'` from `ScopedEntity` and got a
 * GREEN `tsc`, because the only thing that noticed was `contracts/access-fixtures/scope-where.json` — a
 * cross-stack contract also asserted by `Tims.UnitTests`. None of the runbook's six P2 greps would have
 * found it either: all six are `.ts`-scoped.
 *
 * NON-VACUITY FIRST, per this repo's standing lesson. Every assertion below that expects to find nothing
 * is preceded by one that finds something, and the roots are checked to exist before any "no hits"
 * result is believed — a scan over a missing directory reports clean and means nothing.
 */

const ROOT = join(__dirname, '..', '..');

describe('nameVariants — a fixture names the MODEL, not the table', () => {
  it('derives the camelCase singular that flip #2 actually broke', () => {
    // `critical_roles` → the string in scope-where.json is `criticalRole`. Searching the snake-case
    // table name alone finds nothing, which is precisely how the whole P2 sweep missed it.
    expect(nameVariants('critical_roles')).toContain('criticalrole');
    expect(nameVariants('successors')).toContain('successor');
  });

  it('covers snake/Pascal/camel × singular/plural, lower-cased for case-insensitive matching', () => {
    expect(nameVariants('calibration_sessions').sort()).toEqual(
      ['calibration_session', 'calibration_sessions', 'calibrationsession', 'calibrationsessions'].sort(),
    );
  });

  it('does not mangle a name that is already singular or ends in a double s', () => {
    expect(nameVariants('access_reviews')).toContain('access_review');
    expect(nameVariants('addresses')).toContain('address');
    expect(nameVariants('fx_rates')).toContain('fx_rate');
  });

  it('returns nothing for an empty name rather than matching everything', () => {
    // A variant of `''` would match every line of every file. Cheap to get wrong, expensive to notice.
    expect(nameVariants('')).toEqual([]);
    expect(nameVariants('___')).toEqual([]);
  });
});

describe('scanDataFiles — against the real repository', () => {
  it('every pinned data root exists (the population is non-empty before anything is believed)', () => {
    const { perRoot, missingRoots, filesScanned } = scanDataFiles(['successors'], ROOT);
    expect(
      missingRoots,
      'a pinned data root has been renamed or deleted. Until DATA_ROOTS is updated, every scan searches a ' +
        'smaller population and still reports "no hits" — the vacuous pass this control exists to prevent.',
    ).toEqual([]);
    expect(filesScanned).toBeGreaterThan(50);
    // `present` is not enough, and the test's own name is the reason: an existing-but-EMPTY root yields
    // { files: 0, present: true }, contributes nothing to `missingRoots`, and the CLI's gate only fires on
    // a repo-wide filesScanned === 0. Three of the four roots happen to be pinned non-empty by the
    // positive-control tests below, but `scripts/parity` is not — and it is the root whose whole rationale
    // is that the parity harness reads through RAW SQL and so survives model deletion. Converting it to
    // .mjs (the house pattern for scripts) would silently drop it to zero and every gate would stay green.
    for (const r of perRoot) expect(r.files, `${r.path} contributed 0 files`).toBeGreaterThan(0);
    expect(perRoot.map((r) => r.path).sort()).toEqual(DATA_ROOTS.map((r) => r.path).sort());
  });

  it('finds the flip-#2 break in scope-where.json, and classifies it as a BLOCKER', () => {
    const { hits } = scanDataFiles(['critical_roles', 'successors'], ROOT);
    const fixture = hits.filter((h) => h.file === 'contracts/access-fixtures/scope-where.json');
    expect(
      fixture.length,
      'the scan no longer finds `successor`/`criticalRole` in contracts/access-fixtures/scope-where.json. ' +
        'Either the fixture changed or the matcher is broken — in both cases a clean scan for a ' +
        'succession flip would now be a lie.',
    ).toBeGreaterThan(0);
    for (const h of fixture) expect(h.kind).toBe('blocker');
    // The message has to say "keep it", not "delete it": deleting the case removes the oracle pinning
    // Tims.UnitTests' own ScopeWhereForFixtureTests (runbook §1 step 6).
    expect(fixture[0].why).toMatch(/SURVIVE the flip/);
    expect(fixture[0].why).toMatch(/Do NOT delete the case/);
  });

  it('flags a seed that still writes the model (§8 Q9), which is what flip #2 had to port', () => {
    const { hits } = scanDataFiles(['surveys'], ROOT);
    const seed = hits.filter((h) => h.file === 'packages/db/prisma/seed-demo.ts');
    expect(seed.length, 'seed-demo.ts references to a flip target are no longer detected').toBeGreaterThan(0);
    for (const h of seed) expect(h.kind).toBe('blocker');
  });

  it('reports DDL and parity references as INFO, not as blockers', () => {
    // A `CREATE TABLE` in the flip-DDL is the artifact §0 P8 REQUIRES to exist. Failing on it would make
    // the check cry wolf on every flip, and a check that cries wolf gets switched off.
    const { hits } = scanDataFiles(['critical_roles', 'successors'], ROOT);
    const ddl = hits.filter((h) => h.file.startsWith('services/Tims.Platform/db/flip-ddl/'));
    expect(ddl.length, 'the flip-DDL for the flipped succession tables is no longer seen at all').toBeGreaterThan(0);
    for (const h of ddl) expect(h.kind).toBe('info');
  });

  it('returns no hits for a table nobody names — the negative control, run only after the positives', () => {
    const { hits, filesScanned } = scanDataFiles(['zzz_no_such_table'], ROOT);
    expect(filesScanned).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });
});

describe('scanDataFiles — crafted trees', () => {
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'preflip-repo-scan-'));
  });
  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function tree(name: string, files: Record<string, string>, roots = DATA_ROOTS.map((r) => r.path)): string {
    const root = join(sandbox, name);
    for (const r of roots) mkdirSync(join(root, r), { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(root, rel.split('/').slice(0, -1).join('/')), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return root;
  }

  it('reports a missing root instead of silently searching a smaller population', () => {
    const root = tree('missing-root', { 'contracts/a.json': '{}' }, ['contracts']);
    const { missingRoots } = scanDataFiles(['widgets'], root);
    expect(missingRoots).toContain('packages/db/prisma');
    expect(missingRoots).toContain('scripts/parity');
  });

  it('does not match a longer identifier that merely contains the table name', () => {
    // `calibration_sessions_pkey` is an index name, not a reader, and one hit per index per migration
    // file would drown the report. Proved by mutation: dropping the boundary lookarounds for a plain
    // substring match turns this red. (A `\b` version is NOT the mutation to write here — in JavaScript
    // `\b` is equivalent, since `\w` includes `_`. It is the SQL side that cannot use `\b`.)
    const root = tree('boundary', { 'contracts/x.json': '{"index":"calibration_sessions_pkey"}\n' });
    expect(scanDataFiles(['calibration_sessions'], root).hits).toEqual([]);

    const real = tree('boundary-real', { 'contracts/y.json': '{"entity":"calibration_sessions"}\n' });
    expect(scanDataFiles(['calibration_sessions'], real).hits).toHaveLength(1);
  });

  it('matches case-insensitively, so SQL shouting the table name is still found', () => {
    const root = tree('shout', {
      'packages/db/prisma/manual/x.sql': 'ALTER TABLE PUBLIC.SURVEYS ENABLE ROW LEVEL SECURITY;\n',
    });
    const { hits } = scanDataFiles(['surveys'], root);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('info');
  });

  it('skips node_modules at any depth', () => {
    const root = tree('skip', {
      'contracts/node_modules/pkg/fixture.json': '{"entity":"widget"}\n',
      'contracts/real.json': '{"entity":"widget"}\n',
    });
    const { hits } = scanDataFiles(['widgets'], root);
    expect(hits.map((h) => h.file)).toEqual(['contracts/real.json']);
  });

  it('classifies a seed by name, so a NEW seed file is covered without editing the matcher', () => {
    const root = tree('seed', { 'packages/db/prisma/seed-engagement.ts': 'await db.survey.create({});\n' });
    const { hits } = scanDataFiles(['surveys'], root);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('blocker');
    expect(hits[0].why).toMatch(/§8 Q9/);
  });

  it('records the line number, so a hit is a place to look and not just a file name', () => {
    const root = tree('lines', { 'contracts/access-fixtures/f.json': '{\n  "a": 1,\n  "entity": "successor"\n}\n' });
    const { hits } = scanDataFiles(['successors'], root);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
    expect(hits[0].text).toContain('successor');
  });
});
