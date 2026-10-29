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
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli';

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

const vitestJson = (status: string) => ({
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
        },
      ],
    },
  ],
});

const playwrightJson = { config: {}, suites: [], errors: [], stats: {} };

const trx = `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="r" name="s" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results><UnitTestResult testId="g1" testName="Syn.Plain" outcome="Passed" /></Results>
  <TestDefinitions><UnitTest name="Syn.Plain" id="g1"></UnitTest></TestDefinitions>
  <ResultSummary outcome="Completed"><Counters total="1" /></ResultSummary>
</TestRun>`;

function inputs(vitestStatus = 'passed') {
  const pw = join(priv, 'pw.json');
  const vt = join(priv, 'vitest.json');
  const trxDir = join(priv, 'trx');
  mkdirSync(trxDir, { recursive: true });
  writeFileSync(pw, JSON.stringify(playwrightJson));
  writeFileSync(vt, JSON.stringify(vitestJson(vitestStatus)));
  writeFileSync(join(trxDir, 'unit.trx'), trx);
  return { pw, vt, trxDir };
}

function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const findingsPath = join(priv, 'findings.json');
  writeFileSync(findingsPath, JSON.stringify([finding('syn-a')]));
  return { REAUDIT_FINDINGS: findingsPath, REAUDIT_OUT_DIR: join(priv, 'out'), ...extra };
}

function ctx(e: Record<string, string | undefined>) {
  return {
    env: e,
    repoRoot: repo,
    headSha: '0123456789abcdef0123456789abcdef01234567',
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
    expect(await runCli(['--vitest', bad, '--vitest-exit', '0'], ctx(env()))).toBe(2);
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
    const { pw, vt, trxDir } = inputs('passed');
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
        config: {},
        suites: [
          {
            title: 'j.spec.ts',
            specs: [
              {
                title: 'step',
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
