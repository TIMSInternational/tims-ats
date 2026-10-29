import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectPlaywrightReport } from './collect-playwright';
import { collectVitestReport, VITEST_REPORT_MARKER } from './collect-vitest';
import { collectXunitRun } from './collect-xunit';
import { readInventory, reconcileInventory, type BindingInventory } from './inventory';
import type { InventoryEntry } from './inventory-scan';
import { buildReport, launchGate } from './report';
import { statusById, type Observation } from './status';

const ALL = new Set(['vitest', 'playwright', 'xunit'] as const);
const KNOWN = new Set(['syn-a', 'syn-b']);

const entry = (over: Partial<InventoryEntry> & Pick<InventoryEntry, 'file' | 'name'>): InventoryEntry => ({
  id: 'syn-a',
  source: 'vitest',
  line: 1,
  ...over,
});
const inv = (entries: InventoryEntry[], unattributable: string[] = []): BindingInventory => ({
  sha: 'a'.repeat(40),
  entries,
  unattributable,
});

const vitestFile = (name: string, title: string, status = 'passed') => ({
  name,
  status,
  assertionResults: [{ ancestorTitles: ['s'], title, status, fails: false }],
});
const vitestReport = (files: ReturnType<typeof vitestFile>[]) => ({
  reaudit: VITEST_REPORT_MARKER,
  success: true,
  testResults: files,
});

const finding = (id: string) => ({
  id,
  persona: 'recruiter',
  lens: 'journeys',
  category: 'synthetic',
  severity: 'P1',
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

describe('reconcileInventory: an omitted public check is never masked by a passing sibling', () => {
  // Codex r11: two files hold `[finding:syn-a]` checks; only the passing one was recorded.
  const twoFiles = inv([
    entry({ file: 'tests/one.test.ts', name: 's ideal holds [finding:syn-a]' }),
    entry({ file: 'tests/two.test.ts', name: 's second check [finding:syn-a]' }),
  ]);

  it('REGRESSION: the omitted check makes the finding NOT-RUN, the run untrusted, and the launch gate fail', () => {
    const vt = collectVitestReport(
      vitestReport([vitestFile('/abs/repo/tests/one.test.ts', 'ideal holds [finding:syn-a]')]),
      undefined,
      { runExitCode: 0 },
    );
    expect(statusById(vt.observations).get('syn-a')).toBe('FIXED-VERIFIED'); // the premise
    const rec = reconcileInventory(twoFiles, vt.observations, ALL, KNOWN);
    expect(statusById([...vt.observations, ...rec.observations]).get('syn-a')).toBe('NOT-RUN');
    expect(rec.untrusted.join('\n')).toContain('tests/two.test.ts:1');
    const report = buildReport({
      findings: [finding('syn-a')] as never,
      observations: [...vt.observations, ...rec.observations],
      sha: 'a'.repeat(40),
      generatedAt: new Date('2026-10-29T00:00:00Z'),
      untrusted: [...vt.untrusted, ...rec.untrusted],
    });
    expect(report.rows[0]?.status).toBe('NOT-RUN');
    expect(launchGate(report, { missingInputs: [] }).exitCode).toBe(1);
  });

  it('every inventoried check present and passed: no extra observation, no untrusted reason', () => {
    const vt = collectVitestReport(
      vitestReport([
        vitestFile('/abs/repo/tests/one.test.ts', 'ideal holds [finding:syn-a]'),
        vitestFile('/abs/repo/tests/two.test.ts', 'second check [finding:syn-a]'),
      ]),
      undefined,
      { runExitCode: 0 },
    );
    expect(reconcileInventory(twoFiles, vt.observations, ALL, KNOWN)).toEqual({ observations: [], untrusted: [] });
  });

  it('the same name in a DIFFERENT file does not satisfy the entry (file is part of the identity)', () => {
    const vt = collectVitestReport(
      vitestReport([vitestFile('/abs/repo/tests/elsewhere.test.ts', 'ideal holds [finding:syn-a]')]),
      undefined,
      { runExitCode: 0 },
    );
    const one = inv([entry({ file: 'tests/one.test.ts', name: 's ideal holds [finding:syn-a]' })]);
    expect(reconcileInventory(one, vt.observations, ALL, KNOWN).observations).toHaveLength(1);
  });

  it('a file path that only shares a suffix inside a segment does not match', () => {
    const vt = collectVitestReport(
      vitestReport([vitestFile('/abs/repo/tests/xone.test.ts', 'ideal holds [finding:syn-a]')]),
      undefined,
      { runExitCode: 0 },
    );
    const one = inv([entry({ file: 'one.test.ts', name: 's ideal holds [finding:syn-a]' })]);
    expect(reconcileInventory(one, vt.observations, ALL, KNOWN).observations).toHaveLength(1);
  });

  it('a private-binding NOT-RUN (no evidence behind it) does not count as the check being present', () => {
    const notEvidence: Observation = { id: 'syn-a', status: 'NOT-RUN', source: 'vitest', test: 's ideal holds' };
    const one = inv([entry({ file: 'tests/one.test.ts', name: 's ideal holds [finding:syn-a]' })]);
    expect(reconcileInventory(one, [notEvidence], ALL, KNOWN).untrusted).toHaveLength(1);
  });

  it('an UNRESOLVABLE entry (name null) is always NOT-RUN and untrusted, whatever ran', () => {
    const vt = collectVitestReport(
      vitestReport([vitestFile('/abs/repo/tests/one.test.ts', 'ideal holds [finding:syn-a]')]),
      undefined,
      { runExitCode: 0 },
    );
    const r = reconcileInventory(
      inv([entry({ file: 'tests/one.test.ts', name: null, why: 'dynamic title' })]),
      vt.observations,
      ALL,
      KNOWN,
    );
    expect(r.observations.map((o) => o.status)).toEqual(['NOT-RUN']);
    expect(r.untrusted.join('\n')).toContain('dynamic title');
  });

  it('a source that was not supplied: NOT-RUN for its entries, but no untrusted reason (the gate already needs every input)', () => {
    const r = reconcileInventory(
      inv([entry({ source: 'xunit', file: 'services/T/A.cs', name: 'x [finding:syn-a]' })]),
      [],
      new Set(['vitest'] as const),
      KNOWN,
    );
    expect(r.observations.map((o) => o.status)).toEqual(['NOT-RUN']);
    expect(r.untrusted).toEqual([]);
  });

  it('an entry for an id that is not in the findings file is ignored', () => {
    const r = reconcileInventory(inv([entry({ id: 'syn-zz', file: 'tests/a.test.ts', name: null })]), [], ALL, KNOWN);
    expect(r).toEqual({ observations: [], untrusted: [] });
  });

  it('an unattributable occurrence makes the run untrusted', () => {
    const r = reconcileInventory(inv([], ['tests/a.test.ts:3']), [], ALL, KNOWN);
    expect(r.untrusted.join('\n')).toContain('tests/a.test.ts:3');
  });
});

describe('reconcileInventory: playwright and xunit keys', () => {
  const pwReport = (specTitle: string, file = 'specs/j1.spec.ts') => ({
    suites: [
      {
        title: file,
        file,
        specs: [],
        suites: [
          {
            title: 'J1 journey',
            file,
            specs: [
              {
                title: specTitle,
                file,
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
      },
    ],
    errors: [],
  });
  const pwEntry = entry({
    source: 'playwright',
    file: 'e2e/specs/j1.spec.ts',
    name: 'J1 journey › step one',
  });

  it('a Playwright spec matches by its title path below the file suite and its rootDir-relative file', () => {
    const pw = collectPlaywrightReport(pwReport('step one'), { runExitCode: 0 });
    expect(reconcileInventory(inv([pwEntry]), pw.observations, ALL, KNOWN)).toEqual({
      observations: [],
      untrusted: [],
    });
  });

  it('a Playwright entry whose spec is absent is NOT-RUN and untrusted', () => {
    const pw = collectPlaywrightReport(pwReport('another step'), { runExitCode: 0 });
    const r = reconcileInventory(inv([pwEntry]), pw.observations, ALL, KNOWN);
    expect(r.observations.map((o) => o.status)).toEqual(['NOT-RUN']);
    expect(r.untrusted).toHaveLength(1);
  });

  const trx = (names: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="r" name="s" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>${names.map((n, i) => `<UnitTestResult testId="g${i}" testName="${n}" outcome="Passed" />`).join('')}</Results>
  <TestDefinitions>${names.map((n, i) => `<UnitTest name="${n}" id="g${i}"></UnitTest>`).join('')}</TestDefinitions>
  <ResultSummary outcome="Completed"><Counters total="${names.length}" /></ResultSummary>
</TestRun>`;
  const xuEntry = entry({ source: 'xunit', file: 'services/T/A.cs', name: 'per row [finding:syn-a]' });

  it('an xUnit entry matches its exact DisplayName, or a theory row of it', () => {
    for (const name of ['per row [finding:syn-a]', 'per row [finding:syn-a](x: 1)']) {
      const xu = collectXunitRun([{ name: 'a.trx', xml: trx([name]) }], undefined, { runExitCode: 0 });
      expect(reconcileInventory(inv([xuEntry]), xu.observations, ALL, KNOWN).untrusted).toEqual([]);
    }
  });

  it('an xUnit test whose name merely starts with the DisplayName does not match', () => {
    const xu = collectXunitRun([{ name: 'a.trx', xml: trx(['per row [finding:syn-a] extra']) }], undefined, {
      runExitCode: 0,
    });
    expect(reconcileInventory(inv([xuEntry]), xu.observations, ALL, KNOWN).untrusted).toHaveLength(1);
  });
});

describe('readInventory (real git)', () => {
  let root: string;
  const g = (...a: string[]) =>
    execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-inv-')));
    g('init', '-q');
    g('config', 'user.email', 't@example.invalid');
    g('config', 'user.name', 't');
    g('config', 'commit.gpgsign', 'false');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads the COMMITTED sources at the given sha, not the working tree, and skips the harness itself', () => {
    put('tests/one.test.ts', "describe('s', () => { it('ideal holds [finding:syn-a]', () => {}); });\n");
    put('tests/two.test.ts', "describe('s', () => { it('second check [finding:syn-a]', () => {}); });\n");
    put('scripts/reaudit/self.test.ts', "it('fixture [finding:syn-a]', () => {});\n");
    put('docs/x.md', 'see [finding:syn-a]\n');
    g('add', '.');
    g('commit', '-q', '-m', 'one');
    const sha = g('rev-parse', 'HEAD');
    put('tests/three.test.ts', "it('uncommitted [finding:syn-a]', () => {});\n");
    rmSync(join(root, 'tests/two.test.ts'));
    const r = readInventory(root, sha);
    expect(r.sha).toBe(sha);
    expect(r.entries.map((e) => `${e.file}|${e.name}`).sort()).toEqual([
      'tests/one.test.ts|s ideal holds [finding:syn-a]',
      'tests/two.test.ts|s second check [finding:syn-a]',
    ]);
  });

  it('an unattributable occurrence in a committed file is reported with its file and line', () => {
    put('tests/dyn.test.ts', "const id = 'syn-a';\nit(`x [finding:${id}]`, () => {});\n");
    g('add', '.');
    g('commit', '-q', '-m', 'one');
    expect(readInventory(root, g('rev-parse', 'HEAD')).unattributable).toEqual(['tests/dyn.test.ts:2']);
  });

  it('a repository with no tags at all is an empty inventory', () => {
    put('a.test.ts', "it('x', () => {});\n");
    g('add', '.');
    g('commit', '-q', '-m', 'one');
    expect(readInventory(root, g('rev-parse', 'HEAD'))).toEqual({
      sha: g('rev-parse', 'HEAD'),
      entries: [],
      unattributable: [],
    });
  });

  it('an unknown sha throws (an unreadable inventory is never an empty one)', () => {
    put('a.test.ts', "it('x', () => {});\n");
    g('add', '.');
    g('commit', '-q', '-m', 'one');
    expect(() => readInventory(root, 'b'.repeat(40))).toThrow();
  });
});
