import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collectVitest, collectVitestReport, VitestReportError } from './collect-vitest';
import { statusById } from './status';

// Integration: runs the REAL installed Vitest on a fixture with a tagged `test.fails` test. Proves the
// premise (the stock JSON reporter does not say which tests are `test.fails`) and the fix (the reaudit
// reporter does, and the collector never turns such a "pass" into FIXED-VERIFIED).

const repoRoot = resolve(__dirname, '..', '..');
const fixtureConfig = join(__dirname, 'fixtures', 'vitest-fails', 'vitest.config.ts');
const reporter = join(__dirname, 'vitest-json-reporter.ts');
const vitestBin = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

let dir: string;
beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-vitest-reporter-')));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the real Vitest on a fixture config, with CI=true unless `ci` is false (record.ts sets CI=true). */
function runVitest(
  reporterArg: string,
  out: string,
  extra: string[] = [],
  opts: { config?: string; ci?: boolean } = {},
): number | null {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'CI'),
  ) as NodeJS.ProcessEnv;
  if (opts.ci !== false) env.CI = 'true';
  const r = spawnSync(
    process.execPath,
    [
      vitestBin,
      'run',
      '--config',
      opts.config ?? fixtureConfig,
      `--reporter=${reporterArg}`,
      `--outputFile=${out}`,
      ...extra,
    ],
    { cwd: repoRoot, env, encoding: 'utf8' },
  );
  return r.status;
}

type Report = {
  reaudit?: unknown;
  testResults: { assertionResults: { title: string; status: string; fails?: boolean }[] }[];
};

describe('vitest-json-reporter (real Vitest run)', () => {
  it('premise: the stock JSON reporter reports a test.fails test as passed and carries no fails flag', () => {
    const out = join(dir, 'stock.json');
    expect(runVitest('json', out)).toBe(0);
    const r = JSON.parse(readFileSync(out, 'utf8')) as Report;
    const a = r.testResults[0]?.assertionResults.find((x) => x.title.includes('syn-a'));
    expect(a?.status).toBe('passed');
    expect(a && 'fails' in a).toBe(false);
    expect(() => collectVitest(r, undefined, { runExitCode: 0 })).toThrow(/vitest-json-reporter/);
  }, 60_000);

  it('the reaudit reporter marks it, and the collector keeps it out of FIXED-VERIFIED', () => {
    const out = join(dir, 'reaudit.json');
    expect(runVitest(reporter, out)).toBe(0);
    const r = JSON.parse(readFileSync(out, 'utf8')) as Report;
    const byTitle = new Map(r.testResults[0]?.assertionResults.map((x) => [x.title, x.fails]));
    expect(byTitle.get('ideal [finding:syn-a]')).toBe(true);
    expect(byTitle.get('ideal [finding:syn-b]')).toBe(false);
    const s = statusById(collectVitest(r, undefined, { runExitCode: 0 }));
    expect(s.get('syn-a')).toBe('NOT-RUN');
    expect(s.get('syn-b')).toBe('FIXED-VERIFIED');
  }, 60_000);
});

// Evidence is accepted only from a complete, unfiltered run (canonical.ts). The reporter records the
// run's active filters, whether `.only` was allowed, and every file Vitest's own glob selects; the
// collector refuses a filtered or incomplete run. These run the REAL installed Vitest.
describe('vitest-json-reporter: the run record (real Vitest run)', () => {
  const dupConfig = join(__dirname, 'fixtures', 'vitest-dup', 'vitest.config.ts');
  const dupDir = join(__dirname, 'fixtures', 'vitest-dup');
  const name = 'security denies cross-org read';
  const priv = new Map([[name, ['syn-private']]]);
  type RunReport = { reaudit: { run: { filters: string[]; allowOnly: boolean; modules: string[] } } };
  const read = (out: string) => JSON.parse(readFileSync(out, 'utf8')) as RunReport;

  it('a full run records no filters, .only refused under CI, and every globbed file; the collector accepts it', () => {
    const out = join(dir, 'dup-full.json');
    expect(runVitest(reporter, out, [], { config: dupConfig })).toBe(1);
    const r = read(out);
    expect(r.reaudit.run.filters).toEqual([]);
    expect(r.reaudit.run.allowOnly).toBe(false);
    expect(r.reaudit.run.modules).toEqual([join(dupDir, 'a.fixture.ts'), join(dupDir, 'b.fixture.ts')]);
    const vt = collectVitestReport(r, priv, { runExitCode: 1 });
    expect(statusById(vt.observations).get('syn-private')).toBe('REGRESSED');
  }, 60_000);

  it('Codex r15, for real: the same private name in two files, a file filter omits the failing one → refused', () => {
    const out = join(dir, 'dup-a-only.json');
    expect(runVitest(reporter, out, ['a.fixture.ts'], { config: dupConfig })).toBe(0);
    const r = read(out);
    expect(r.reaudit.run.filters.join(' ')).toContain('a.fixture.ts');
    expect(() => collectVitestReport(r, priv, { runExitCode: 0 })).toThrow(VitestReportError);
  }, 60_000);

  it('a -t filter is recorded and refused (Vitest reports the other tests skipped, not absent)', () => {
    const out = join(dir, 'fails-t.json');
    expect(runVitest(reporter, out, ['-t', 'syn-a'])).toBe(0);
    const r = read(out);
    expect(r.reaudit.run.filters.join(' ')).toContain('syn-a');
    expect(() => collectVitestReport(r, undefined, { runExitCode: 0 })).toThrow(/syn-a/);
  }, 60_000);

  it('a run without CI allows .only, and is refused', () => {
    const out = join(dir, 'fails-noci.json');
    expect(runVitest(reporter, out, [], { ci: false })).toBe(0);
    const r = read(out);
    expect(r.reaudit.run.allowOnly).toBe(true);
    expect(() => collectVitestReport(r, undefined, { runExitCode: 0 })).toThrow(/only/);
  }, 60_000);
});
