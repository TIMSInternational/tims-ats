import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collectVitest } from './collect-vitest';
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

function runVitest(reporterArg: string, out: string): number | null {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')),
  ) as NodeJS.ProcessEnv;
  const r = spawnSync(
    process.execPath,
    [vitestBin, 'run', '--config', fixtureConfig, `--reporter=${reporterArg}`, `--outputFile=${out}`],
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
