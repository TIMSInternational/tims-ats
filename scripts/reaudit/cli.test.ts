import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  realpathSync,
  symlinkSync,
  utimesSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitContext, runCli } from './cli';
import { VITEST_REPORT_MARKER } from './collect-vitest';
import { canonicalArgv } from './canonical';
import { manifestPathFor, writeProvenance, type EvidenceKind } from './provenance';

// `pnpm exec tsx scripts/reaudit/cli.ts --playwright <json> --vitest <json> --trx <dir>
//    [--with-owner-checks] [--gate launch]`
// Private locations come ONLY from the environment (no private path is baked into the public repo):
//   REAUDIT_FINDINGS (required) · REAUDIT_OUT_DIR (required) · REAUDIT_BINDINGS · REAUDIT_WP_INDEX ·
//   REAUDIT_OWNER_CHECKS_DIR (required with --with-owner-checks).
// Exit codes: 0 ok / gate passed · 1 gate failed · 2 cannot run (missing/invalid input, refused path).

let root: string;
let repo: string;
let priv: string;
let lines: string[];

const finding = (id: string, severity = 'P1') => ({
  id,
  persona: 'recruiter',
  lens: 'journeys',
  category: 'synthetic',
  severity,
  title: 't',
  detail: 'd',
  evidence: [],
  userImpact: 'u',
  recommendation: 'r',
  fixLocation: 'l',
  effort: 'S',
  launchScope: 'launch-v1',
  status: 'new',
  verification: null,
});

/** A complete, unfiltered run as the reaudit reporter records it (see collect-vitest.ts). */
const vitestRun = (modules: string[], filters: string[] = []) => ({
  ...VITEST_REPORT_MARKER,
  run: { filters, allowOnly: false, modules },
});

const vitestJson = (status: string) => ({
  reaudit: vitestRun(['/abs/synthetic.test.ts']),
  numTotalTests: 1,
  success: status === 'passed',
  testResults: [
    {
      name: '/abs/synthetic.test.ts',
      status,
      assertionResults: [
        {
          ancestorTitles: ['s'],
          title: 'ideal holds [finding:syn-a]',
          fullName: 's ideal holds [finding:syn-a]',
          status,
          fails: false,
        },
      ],
    },
  ],
});

/** The run configuration the canonical Playwright run reports (see collect-playwright.ts). */
const pwConfig = (projects: string[] = []) => ({
  forbidOnly: true,
  shard: null,
  grepInvert: null,
  projects: projects.map((name) => ({ name })),
});
const playwrightJson = { config: pwConfig(), suites: [], errors: [], stats: {} };

const trx = `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="r" name="s" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results><UnitTestResult testId="g1" testName="Syn.Plain" outcome="Passed" /></Results>
  <TestDefinitions><UnitTest name="Syn.Plain" id="g1"></UnitTest></TestDefinitions>
  <ResultSummary outcome="Completed"><Counters total="1" /></ResultSummary>
</TestRun>`;

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const OLD = 'fedcba9876543210fedcba9876543210fedcba98';

/** Records provenance for `output` the way scripts/reaudit/record.ts does after a run (replacing any). */
function stamp(
  kind: EvidenceKind,
  output: string,
  over: { sha?: string; exitCode?: number; dirtyPaths?: string[]; argv?: string[] } = {},
): void {
  rmSync(manifestPathFor(output, kind), { force: true });
  writeProvenance({
    kind,
    output,
    headSha: over.sha ?? HEAD,
    exitCode: over.exitCode ?? 0,
    dirtyPaths: over.dirtyPaths ?? [],
    checkoutRoot: '/abs',
    argv: over.argv ?? canonicalArgv(kind, output),
  });
}

function inputs(vitestStatus = 'passed', vitestExit = vitestStatus === 'passed' ? 0 : 1) {
  const pw = join(priv, 'pw.json');
  const vt = join(priv, 'vitest.json');
  const trxDir = join(priv, 'trx');
  mkdirSync(trxDir, { recursive: true });
  writeFileSync(pw, JSON.stringify(playwrightJson));
  writeFileSync(vt, JSON.stringify(vitestJson(vitestStatus)));
  writeFileSync(join(trxDir, 'unit.trx'), trx);
  stamp('playwright', pw);
  stamp('vitest', vt, { exitCode: vitestExit });
  stamp('xunit', trxDir);
  return { pw, vt, trxDir };
}

function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const findingsPath = join(priv, 'findings.json');
  writeFileSync(findingsPath, JSON.stringify([finding('syn-a')]));
  return { REAUDIT_FINDINGS: findingsPath, REAUDIT_OUT_DIR: join(priv, 'out'), ...extra };
}

function ctx(e: Record<string, string | undefined>, over: { dirtyPaths?: string[] } = {}) {
  return {
    env: e,
    repoRoot: repo,
    headSha: HEAD,
    dirtyPaths: over.dirtyPaths ?? [],
    now: new Date('2026-10-28T12:00:00Z'),
    log: (s: string) => lines.push(s),
    err: (s: string) => lines.push(s),
  };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-cli-')));
  repo = join(root, 'repo');
  priv = join(root, 'private');
  mkdirSync(repo, { recursive: true });
  mkdirSync(priv, { recursive: true });
  lines = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('runCli — refusal paths (exit 2)', () => {
  it('no inputs at all → 2', async () => {
    expect(await runCli([], ctx(env()))).toBe(2);
  });

  it('an unknown flag → 2', async () => {
    const { vt } = inputs();
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0', '--bogus'], ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain('--bogus');
  });

  it('--gate with anything but "launch" → 2', async () => {
    const { vt } = inputs();
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0', '--gate', 'release'], ctx(env()))).toBe(2);
  });

  it('--gate launch requires all three inputs; a missing one → 2 and it is named', async () => {
    const { vt } = inputs();
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0', '--gate', 'launch'], ctx(env()))).toBe(2);
    const out = lines.join('\n');
    expect(out).toContain('--playwright');
    expect(out).toContain('--trx');
  });

  it('an input file that does not exist → 2 and the path is named', async () => {
    const missing = join(priv, 'absent.json');
    expect(await runCli(['--vitest', missing, '--vitest-exit', '0'], ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain(missing);
  });

  it('REAUDIT_FINDINGS unset → 2 naming the variable (no built-in default path)', async () => {
    const { vt } = inputs();
    const e = env();
    delete e.REAUDIT_FINDINGS;
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0'], ctx(e))).toBe(2);
    expect(lines.join('\n')).toContain('REAUDIT_FINDINGS');
  });

  it('REAUDIT_OUT_DIR unset → 2 naming the variable', async () => {
    const { vt } = inputs();
    const e = env();
    delete e.REAUDIT_OUT_DIR;
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0'], ctx(e))).toBe(2);
    expect(lines.join('\n')).toContain('REAUDIT_OUT_DIR');
  });

  it('REAUDIT_OUT_DIR inside the repo → 2, and nothing is written into the repo', async () => {
    const { vt } = inputs();
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0'], ctx(env({ REAUDIT_OUT_DIR: join(repo, 'out') })))).toBe(
      2,
    );
    expect(readdirSync(repo)).toEqual([]);
    expect(lines.join('\n')).toMatch(/REAUDIT_OUT_DIR is inside the repository/);
  });

  it('REAUDIT_FINDINGS inside the repo → 2', async () => {
    const { vt } = inputs();
    const inside = join(repo, 'findings.json');
    writeFileSync(inside, JSON.stringify([finding('syn-a')]));
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0'], ctx(env({ REAUDIT_FINDINGS: inside })))).toBe(2);
  });

  it('--with-owner-checks without REAUDIT_OWNER_CHECKS_DIR → 2', async () => {
    const { vt } = inputs();
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0', '--with-owner-checks'], ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain('REAUDIT_OWNER_CHECKS_DIR');
  });

  it('--vitest without --vitest-exit → 2 and the missing flag is named (the JSON alone cannot show an unhandled error)', async () => {
    const { vt } = inputs();
    expect(await runCli(['--vitest', vt], ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain('--vitest-exit');
  });

  it('--vitest-exit that is not an exit status → 2', async () => {
    const { vt } = inputs();
    for (const bad of ['x', '-1', '256', '1.5', '']) {
      lines = [];
      expect(await runCli(['--vitest', vt, '--vitest-exit', bad], ctx(env()))).toBe(2);
      expect(lines.join('\n')).toContain('--vitest-exit');
    }
  });

  it('--vitest-exit without --vitest → 2', async () => {
    const { pw } = inputs();
    expect(await runCli(['--playwright', pw, '--vitest-exit', '0'], ctx(env()))).toBe(2);
  });

  it('a corrupt input report → 2 (not silently treated as zero tests)', async () => {
    const bad = join(priv, 'bad.json');
    writeFileSync(bad, '{"not":"a vitest report"}');
    stamp('vitest', bad);
    expect(await runCli(['--vitest', bad, '--vitest-exit', '0'], ctx(env()))).toBe(2);
  });
});

const all = (pw: string, vt: string, trxDir: string) => [
  '--playwright',
  pw,
  '--vitest',
  vt,
  '--vitest-exit',
  '0',
  '--trx',
  trxDir,
  '--gate',
  'launch',
];

describe('runCli — evidence provenance (exit 2)', () => {
  it('a Playwright report recorded at another commit → 2 naming the file (old evidence is not HEAD evidence)', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    stamp('playwright', pw, { sha: OLD });
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain(pw);
    expect(lines.join('\n')).toContain(OLD);
  });

  it('a Vitest report recorded at another commit → 2 naming the file', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    stamp('vitest', vt, { sha: OLD });
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain(vt);
  });

  it('a TRX directory recorded at another commit → 2 naming it', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    stamp('xunit', trxDir, { sha: OLD });
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain(trxDir);
  });

  it('evidence inside the repository → 2 naming the input, even with a valid manifest', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const inside = join(repo, 'vitest.json');
    writeFileSync(inside, readFileSync(vt));
    stamp('vitest', inside);
    const argv = all(pw, inside, trxDir);
    expect(await runCli(argv, ctx(env()))).toBe(2);
    expect(lines.join('\n')).toMatch(/--vitest.*inside the repository/);
  });

  it('a TRX directory reached through a directory symlink into the repository → 2', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const insideDir = join(repo, 'trx');
    mkdirSync(insideDir);
    writeFileSync(join(insideDir, 'unit.trx'), readFileSync(join(trxDir, 'unit.trx')));
    stamp('xunit', insideDir);
    const link = join(priv, 'trx-link');
    symlinkSync(insideDir, link);
    expect(await runCli(all(pw, vt, link), ctx(env()))).toBe(2);
  });

  it('a report with no provenance manifest → 2 (an unrecorded report is not evidence of anything)', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    rmSync(manifestPathFor(pw, 'playwright'));
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain(pw);
  });

  it('a newer-looking copy of an old report is still refused: timestamps are not provenance', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    stamp('vitest', vt, { sha: OLD });
    const future = new Date(Date.now() + 86_400_000);
    utimesSync(vt, future, future);
    utimesSync(manifestPathFor(vt, 'vitest'), future, future);
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
  });

  it('evidence of HEAD with an old mtime is accepted (mtime plays no part)', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const old = new Date('2001-01-01T00:00:00Z');
    utimesSync(vt, old, old);
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(0);
  });

  it('stale evidence is refused without --gate too, and no report is written', async () => {
    const { vt } = inputs('passed');
    stamp('vitest', vt, { sha: OLD });
    const e = env();
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0'], ctx(e))).toBe(2);
    expect(existsSync(e.REAUDIT_OUT_DIR as string)).toBe(false);
  });

  it('--vitest-exit that disagrees with the recorded exit status → 2', async () => {
    const { vt } = inputs('passed', 1);
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0'], ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain('--vitest-exit');
  });

  it('--gate launch with evidence recorded on a dirty tree → 2 naming the dirty path', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    stamp('playwright', pw, { dirtyPaths: ['e2e/specs/extra.spec.ts'] });
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain('e2e/specs/extra.spec.ts');
  });

  it('without --gate, evidence recorded on a dirty tree is accepted', async () => {
    const { vt } = inputs('passed');
    stamp('vitest', vt, { dirtyPaths: ['x.ts'] });
    expect(await runCli(['--vitest', vt, '--vitest-exit', '0'], ctx(env()))).toBe(0);
  });

  it('--gate launch on a working tree with uncommitted changes → 2 (the evidence is not of HEAD)', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    expect(await runCli(all(pw, vt, trxDir), ctx(env(), { dirtyPaths: ['untracked.ts'] }))).toBe(2);
    expect(lines.join('\n')).toMatch(/uncommitted/);
  });
});

// main() builds its context from REAL git: this runs that code in a throwaway repository.
describe('gitContext + runCli (real git)', () => {
  let gitRepo: string;
  const g = (...a: string[]) =>
    execFileSync('git', a, { cwd: gitRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  beforeEach(() => {
    gitRepo = join(root, 'gitrepo');
    mkdirSync(gitRepo);
    g('init', '-q');
    g('config', 'user.email', 't@example.invalid');
    g('config', 'user.name', 't');
    g('config', 'commit.gpgsign', 'false');
    writeFileSync(join(gitRepo, '.gitignore'), 'ignored/\n');
    g('add', '.');
    g('commit', '-q', '-m', 'init');
  });

  const run = async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const base = gitContext(gitRepo);
    for (const [k, p] of [
      ['playwright', pw],
      ['vitest', vt],
      ['xunit', trxDir],
    ] as const)
      stamp(k, p, { sha: base.headSha });
    return runCli(all(pw, vt, trxDir), { ...ctx(env()), ...base });
  };

  it('a clean checkout → the gate runs (0)', async () => {
    expect(gitContext(gitRepo).dirtyPaths).toEqual([]);
    expect(await run()).toBe(0);
  });

  it('an UNTRACKED file in the checkout → the gate refuses (2)', async () => {
    writeFileSync(join(gitRepo, 'extra.spec.ts'), 'x');
    expect(gitContext(gitRepo).dirtyPaths).toEqual(['extra.spec.ts']);
    expect(await run()).toBe(2);
  });

  it('evidence inside a SIBLING worktree of the checkout → 2', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const base = gitContext(gitRepo);
    const sib = join(root, 'sibling-wt');
    g('worktree', 'add', '-q', '--detach', sib);
    const inside = join(sib, 'pw.json');
    writeFileSync(inside, readFileSync(pw));
    stamp('playwright', inside, { sha: base.headSha });
    stamp('vitest', vt, { sha: base.headSha });
    stamp('xunit', trxDir, { sha: base.headSha });
    expect(await runCli(all(inside, vt, trxDir), { ...ctx(env()), ...base })).toBe(2);
    expect(lines.join('\n')).toMatch(/inside the repository/);
  });

  it('a gitignored file does not count', async () => {
    mkdirSync(join(gitRepo, 'ignored'));
    writeFileSync(join(gitRepo, 'ignored', 'results.json'), '{}');
    expect(await run()).toBe(0);
  });
});

describe('runCli — happy paths', () => {
  it('--gate launch: the only launch P1 is FIXED-VERIFIED → 0, and the report is written outside the repo', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const e = env();
    expect(
      await runCli(
        ['--playwright', pw, '--vitest', vt, '--vitest-exit', '0', '--trx', trxDir, '--gate', 'launch'],
        ctx(e),
      ),
    ).toBe(0);
    const outDir = e.REAUDIT_OUT_DIR as string;
    expect(readdirSync(outDir).sort()).toEqual(['2026-10-28-01234567.json', '2026-10-28-01234567.md']);
    expect(readdirSync(repo)).toEqual([]);
  });

  it('--gate launch: the launch P1 is REGRESSED → 1', async () => {
    const { pw, vt, trxDir } = inputs('failed');
    expect(
      await runCli(
        ['--playwright', pw, '--vitest', vt, '--vitest-exit', '1', '--trx', trxDir, '--gate', 'launch'],
        ctx(env()),
      ),
    ).toBe(1);
    expect(lines.join('\n')).toContain('syn-a');
  });

  it('--gate launch: green vitest JSON but a non-zero vitest exit (unhandled error) → 1, the id is NOT-RUN', async () => {
    const { pw, vt, trxDir } = inputs('passed', 1);
    const e = env();
    expect(
      await runCli(
        ['--playwright', pw, '--vitest', vt, '--vitest-exit', '1', '--trx', trxDir, '--gate', 'launch'],
        ctx(e),
      ),
    ).toBe(1);
    const report = JSON.parse(readFileSync(join(e.REAUDIT_OUT_DIR as string, '2026-10-28-01234567.json'), 'utf8')) as {
      rows: { id: string; status: string }[];
    };
    expect(report.rows.find((r) => r.id === 'syn-a')?.status).toBe('NOT-RUN');
  });

  it('--gate launch: a Playwright global error turns a green journey pass into a failed gate', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    writeFileSync(
      pw,
      JSON.stringify({
        config: pwConfig(['recruiter']),
        suites: [
          {
            title: 'j.spec.ts',
            specs: [
              {
                title: 'step',
                tags: ['finding:syn-a'],
                tests: [
                  {
                    projectName: 'recruiter',
                    expectedStatus: 'passed',
                    annotations: [{ type: 'finding-fixed', description: 'syn-a' }],
                    results: [{ retry: 0, status: 'passed' }],
                  },
                ],
              },
            ],
          },
        ],
        errors: [{ message: 'Error: globalTeardown failed' }],
        stats: {},
      }),
    );
    stamp('playwright', pw);
    expect(
      await runCli(
        ['--playwright', pw, '--vitest', vt, '--vitest-exit', '0', '--trx', trxDir, '--gate', 'launch'],
        ctx(env()),
      ),
    ).toBe(1);
  });

  it('declared owner bindings without --with-owner-checks are NOT-RUN, so the gate cannot pass', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const bindingsPath = join(priv, 'bindings.json');
    writeFileSync(bindingsPath, JSON.stringify({ version: 1, tests: [], ownerChecks: ['syn-a'] }));
    const e = env({ REAUDIT_BINDINGS: bindingsPath });
    expect(
      await runCli(
        ['--playwright', pw, '--vitest', vt, '--vitest-exit', '0', '--trx', trxDir, '--gate', 'launch'],
        ctx(e),
      ),
    ).toBe(1);
    const report = JSON.parse(readFileSync(join(e.REAUDIT_OUT_DIR as string, '2026-10-28-01234567.json'), 'utf8')) as {
      rows: { id: string; status: string }[];
    };
    expect(report.rows.find((r) => r.id === 'syn-a')?.status).toBe('NOT-RUN');
  });

  it('without --gate, one input is enough; exit 0 and the report is written', async () => {
    const { vt } = inputs('failed');
    const e = env();
    expect(await runCli(['--vitest', vt, '--vitest-exit', '1'], ctx(e))).toBe(0);
    expect(existsSync(join(e.REAUDIT_OUT_DIR as string, '2026-10-28-01234567.json'))).toBe(true);
  });
});

describe('runCli — an untrusted Playwright run blocks every pass', () => {
  const pwWith = (pw: string, specs: unknown[]) =>
    writeFileSync(
      pw,
      JSON.stringify({
        config: pwConfig(['recruiter']),
        suites: [{ title: 'j.spec.ts', specs }],
        errors: [],
        stats: {},
      }),
    );
  const spec = (title: string, tags: string[], status: string) => ({
    title,
    tags,
    tests: [{ projectName: 'recruiter', expectedStatus: 'passed', annotations: [], results: [{ retry: 0, status }] }],
  });

  it('an untagged failing journey test → gate 1, and even a vitest-verified id is NOT-RUN', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    pwWith(pw, [spec('setup step', [], 'failed')]);
    stamp('playwright', pw, { exitCode: 1 });
    const e = env();
    expect(await runCli(all(pw, vt, trxDir), ctx(e))).toBe(1);
    const report = JSON.parse(readFileSync(join(e.REAUDIT_OUT_DIR as string, '2026-10-28-01234567.json'), 'utf8')) as {
      rows: { id: string; status: string }[];
      untrusted: string[];
    };
    expect(report.rows.find((r) => r.id === 'syn-a')?.status).toBe('NOT-RUN');
    expect(report.untrusted.join('\n')).toContain('setup step');
    expect(lines.join('\n')).toContain('setup step');
  });

  it('a Playwright run that exited non-zero with an all-green JSON → gate 1', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    stamp('playwright', pw, { exitCode: 1 });
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(1);
  });
});

// Round-7 class: a failed Vitest or .NET run reaches report-level distrust, so another source's pass
// cannot carry the gate.
describe('runCli — a failed Vitest or .NET run blocks every pass', () => {
  const taggedTrx = `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="r" name="s" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results><UnitTestResult testId="g1" testName="ideal [finding:syn-a]" outcome="Passed" /></Results>
  <TestDefinitions><UnitTest name="ideal [finding:syn-a]" id="g1"></UnitTest></TestDefinitions>
  <ResultSummary outcome="Completed"><Counters total="1" /></ResultSummary>
</TestRun>`;

  it('xUnit pass + recorded .NET exit 1 (a project that wrote no TRX) → gate 1, the id is NOT-RUN', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    writeFileSync(join(trxDir, 'unit.trx'), taggedTrx);
    stamp('xunit', trxDir, { exitCode: 1 });
    const e = env();
    expect(await runCli(all(pw, vt, trxDir), ctx(e))).toBe(1);
    const report = JSON.parse(readFileSync(join(e.REAUDIT_OUT_DIR as string, '2026-10-28-01234567.json'), 'utf8')) as {
      rows: { id: string; status: string }[];
    };
    expect(report.rows.find((r) => r.id === 'syn-a')?.status).toBe('NOT-RUN');
  });

  it('xUnit pass + a Vitest file that failed before discovery (exit 1) → gate 1, the id is NOT-RUN', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    writeFileSync(
      vt,
      JSON.stringify({
        reaudit: vitestRun(['/abs/broken.test.ts']),
        success: false,
        testResults: [{ name: '/abs/broken.test.ts', status: 'failed', message: 'boom', assertionResults: [] }],
      }),
    );
    stamp('vitest', vt, { exitCode: 1 });
    writeFileSync(join(trxDir, 'unit.trx'), taggedTrx);
    stamp('xunit', trxDir);
    const e = env();
    const argv = all(pw, vt, trxDir);
    argv[argv.indexOf('--vitest-exit') + 1] = '1';
    expect(await runCli(argv, ctx(e))).toBe(1);
    const report = JSON.parse(readFileSync(join(e.REAUDIT_OUT_DIR as string, '2026-10-28-01234567.json'), 'utf8')) as {
      rows: { id: string; status: string }[];
      untrusted: string[];
    };
    expect(report.rows.find((r) => r.id === 'syn-a')?.status).toBe('NOT-RUN');
    expect(report.untrusted.join('\n')).toContain('broken.test.ts');
  });
});

// Evidence is accepted only from the canonical full-suite command (canonical.ts) and only when the run
// shows it was complete. This replaced inferring, from committed source, which checks should have run.
describe('runCli — only complete, unfiltered runs are evidence (exit 2)', () => {
  it('a manifest recording a FILTERED command is refused for every kind, naming the input', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    for (const [kind, path, argv] of [
      ['vitest', vt, [...canonicalArgv('vitest', vt), 'synthetic.test.ts']],
      ['playwright', pw, [...canonicalArgv('playwright', pw), '--grep', '@finding:syn-a']],
      ['xunit', trxDir, [...canonicalArgv('xunit', trxDir), '--filter', 'Category!=LiveNetwork']],
    ] as const) {
      lines = [];
      stamp(kind, path, { argv: [...argv] });
      expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
      expect(lines.join('\n')).toMatch(/canonical/);
      stamp(kind, path);
    }
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(0);
  });

  it('Codex r11: a [finding:syn-a] check in a file the run did not report → 2, even though its sibling passed', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const j = vitestJson('passed');
    j.reaudit = vitestRun(['/abs/synthetic.test.ts', '/abs/other.test.ts']);
    writeFileSync(vt, JSON.stringify(j));
    stamp('vitest', vt);
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
    expect(lines.join('\n')).toContain('/abs/other.test.ts');
  });

  it('Codex r15: one private full name in two files, one file omitted → 2 (no FIXED-VERIFIED, no gate pass)', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const name = 'security denies cross-org read';
    const bindingsPath = join(priv, 'bindings.json');
    writeFileSync(
      bindingsPath,
      JSON.stringify({ version: 1, tests: [{ id: 'syn-a', source: 'vitest', name }], ownerChecks: [] }),
    );
    const j = {
      reaudit: vitestRun(['/abs/tests/a.test.ts', '/abs/tests/b.test.ts']),
      success: true,
      testResults: [
        {
          name: '/abs/tests/a.test.ts',
          status: 'passed',
          assertionResults: [
            {
              ancestorTitles: ['security'],
              title: 'denies cross-org read',
              fullName: name,
              status: 'passed',
              fails: false,
            },
          ],
        },
      ],
    };
    writeFileSync(vt, JSON.stringify(j));
    stamp('vitest', vt);
    const e = env({ REAUDIT_BINDINGS: bindingsPath });
    expect(await runCli(all(pw, vt, trxDir), ctx(e))).toBe(2);
    expect(lines.join('\n')).toContain('/abs/tests/b.test.ts');
    expect(existsSync(join(e.REAUDIT_OUT_DIR as string, '2026-10-28-01234567.json'))).toBe(false);
  });

  it('a filtered Vitest run (the reporter saw -t) is refused even under the canonical argv', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    const j = vitestJson('passed');
    j.reaudit = vitestRun(['/abs/synthetic.test.ts'], ['-t syn']);
    writeFileSync(vt, JSON.stringify(j));
    stamp('vitest', vt);
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
  });

  it('a Playwright run without forbidOnly is refused', async () => {
    const { pw, vt, trxDir } = inputs('passed');
    writeFileSync(pw, JSON.stringify({ ...playwrightJson, config: { ...pwConfig(), forbidOnly: false } }));
    stamp('playwright', pw);
    expect(await runCli(all(pw, vt, trxDir), ctx(env()))).toBe(2);
  });
});
