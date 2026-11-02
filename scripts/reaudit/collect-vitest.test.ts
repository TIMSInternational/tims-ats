import { describe, it, expect } from 'vitest';
import { collectVitest, collectVitestReport, VITEST_REPORT_MARKER, VitestReportError } from './collect-vitest';
import { statusById } from './status';

// Shape of `npx vitest run --reporter=./scripts/reaudit/vitest-json-reporter.ts --outputFile=<f>`: the
// stock jest-compatible JSON plus `fails` on every assertion and a top-level `reaudit` marker.
// A test binds when its FULL name (ancestor describe titles + leaf title) contains `[finding:<id>]`.

type Assertion = { ancestorTitles: string[]; title: string; status: string; fails?: boolean };

type RunInfo = { filters: string[]; allowOnly: boolean; modules: string[] };

/**
 * `reaudit.run` is what the reporter records about the run: active filters, whether `.only` was allowed,
 * and every test file Vitest's own glob selects. Unless a test overrides it, `modules` follows the
 * report's files (a complete run), so tests that add files stay complete.
 */
function vitestJson(assertions: Assertion[]): {
  reaudit: typeof VITEST_REPORT_MARKER & { run: RunInfo };
  numTotalTests: number;
  success: boolean;
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: (Assertion & { fullName: string })[];
  }[];
} {
  const report = {
    reaudit: {
      ...VITEST_REPORT_MARKER,
      run: {
        filters: [] as string[],
        allowOnly: false,
        get modules(): string[] {
          return report.testResults.map((r) => r.name);
        },
      } as RunInfo,
    },
    numTotalTests: assertions.length,
    success: true,
    testResults: [
      {
        name: '/abs/tests/synthetic.test.ts',
        status: 'passed',
        message: undefined as string | undefined,
        assertionResults: assertions.map((a) => ({
          ...a,
          fails: a.fails ?? false,
          fullName: [...a.ancestorTitles, a.title].join(' '),
        })),
      },
    ],
  };
  return report;
}

describe('collectVitest', () => {
  it('binds a tag in the leaf title', () => {
    const j = vitestJson([{ ancestorTitles: ['suite'], title: 'works [finding:syn-a]', status: 'passed' }]);
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('binds a tag in a NESTED describe name (not only the leaf)', () => {
    const j = vitestJson([{ ancestorTitles: ['outer', 'inner [finding:syn-a]'], title: 'leaf', status: 'passed' }]);
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('one test may carry several ids', () => {
    const j = vitestJson([{ ancestorTitles: ['[finding:syn-a]'], title: 'leaf [finding:syn-b]', status: 'passed' }]);
    const byId = statusById(collectVitest(j));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('FIXED-VERIFIED');
  });

  it('two tests on the same id, one failing → REGRESSED', () => {
    const j = vitestJson([
      { ancestorTitles: ['s'], title: 'one [finding:syn-a]', status: 'passed' },
      { ancestorTitles: ['s'], title: 'two [finding:syn-a]', status: 'failed' },
    ]);
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('REGRESSED');
  });

  it('skipped / todo tests bound to an id → STALE-BINDING', () => {
    const j = vitestJson([
      { ancestorTitles: ['s'], title: 'skip [finding:syn-a]', status: 'skipped' },
      { ancestorTitles: ['s'], title: 'todo [finding:syn-b]', status: 'todo' },
      { ancestorTitles: ['s'], title: 'pending [finding:syn-c]', status: 'pending' },
    ]);
    const byId = statusById(collectVitest(j));
    expect(byId.get('syn-a')).toBe('STALE-BINDING');
    expect(byId.get('syn-b')).toBe('STALE-BINDING');
    expect(byId.get('syn-c')).toBe('STALE-BINDING');
  });

  it('a test with no tag binds nothing (the id stays unbound)', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'plain test', status: 'failed' }]);
    expect(collectVitest(j)).toEqual([]);
  });

  it('a malformed tag (not a slug) is not a binding', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'x [finding:Not A Slug]', status: 'passed' }]);
    expect(collectVitest(j)).toEqual([]);
  });

  it('extra name bindings (private) bind an untagged test by its exact full name', () => {
    const j = vitestJson([{ ancestorTitles: ['security'], title: 'denies cross-org read', status: 'passed' }]);
    const extra = new Map([['security denies cross-org read', ['syn-private']]]);
    expect(statusById(collectVitest(j, extra)).get('syn-private')).toBe('FIXED-VERIFIED');
  });

  it('a private binding whose test is ABSENT from the report is NOT-RUN, so a sibling pass cannot mask it', () => {
    const j = vitestJson([{ ancestorTitles: ['security'], title: 'present check', status: 'passed' }]);
    const extra = new Map([
      ['security present check', ['syn-private']],
      ['security renamed or filtered check', ['syn-private']],
    ]);
    const obs = collectVitest(j, extra);
    expect(obs).toContainEqual({
      id: 'syn-private',
      status: 'NOT-RUN',
      source: 'vitest',
      test: 'security renamed or filtered check',
    });
    expect(statusById(obs).get('syn-private')).toBe('NOT-RUN');
  });

  it('observations carry source and full test name', () => {
    const j = vitestJson([{ ancestorTitles: ['outer'], title: 'leaf [finding:syn-a]', status: 'passed' }]);
    const [o] = collectVitest(j);
    expect(o?.source).toBe('vitest');
    expect(o?.test).toBe('outer leaf [finding:syn-a]');
  });

  // Real vitest JSON for a failed afterAll: the FILE is failed with an empty message, `success` is
  // false, and the assertion itself still reads "passed".
  it('a passing bound test in a FILE that failed outside its assertions (e.g. afterAll) is NOT-RUN', () => {
    const j = vitestJson([{ ancestorTitles: ['probe'], title: 'bound passes [finding:syn-a]', status: 'passed' }]);
    j.success = false;
    (j.testResults[0] as { status: string; message?: string }).status = 'failed';
    (j.testResults[0] as { status: string; message?: string }).message = '';
    const obs = collectVitest(j);
    expect(statusById(obs).get('syn-a')).toBe('NOT-RUN');
  });

  it('a private name binding in a failed file is NOT-RUN too', () => {
    const j = vitestJson([{ ancestorTitles: ['security'], title: 'present check', status: 'passed' }]);
    j.success = false;
    j.testResults[0]!.status = 'failed';
    const extra = new Map([['security present check', ['syn-private']]]);
    expect(statusById(collectVitest(j, extra)).get('syn-private')).toBe('NOT-RUN');
  });

  it('a failing bound test in a failed file is still REGRESSED (a downgrade never hides a red)', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'red [finding:syn-a]', status: 'failed' }]);
    j.success = false;
    j.testResults[0]!.status = 'failed';
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('REGRESSED');
  });

  it('success:false with no failed file (an unhandled error) makes every pass NOT-RUN', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'ok [finding:syn-a]', status: 'passed' }]);
    j.success = false;
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('NOT-RUN');
  });

  // A failed file already explains a non-zero exit, so an unhandled error in the same run cannot be
  // ruled out from the JSON. Every pass in such a run is distrusted, not only those in the failed file.
  it('a pass in a PASSED file is NOT-RUN when a different file failed (an unhandled error cannot be ruled out)', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'ok [finding:syn-a]', status: 'passed' }]);
    j.success = false;
    j.testResults.push({
      name: '/abs/tests/other.test.ts',
      status: 'failed',
      assertionResults: [
        {
          ancestorTitles: ['o'],
          title: 'ok too [finding:syn-b]',
          status: 'passed',
          fails: false,
          fullName: 'o ok too [finding:syn-b]',
        },
      ],
    });
    const byId = statusById(collectVitest(j));
    expect(byId.get('syn-a')).toBe('NOT-RUN');
    expect(byId.get('syn-b')).toBe('NOT-RUN');
  });

  it('a failed unbound file plus a non-zero exit leaves no pass in any other file FIXED-VERIFIED', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'critical [finding:syn-a]', status: 'passed' }]);
    j.success = false;
    j.testResults.push({ name: '/abs/tests/other.test.ts', status: 'failed', assertionResults: [] });
    expect(statusById(collectVitest(j, undefined, { runExitCode: 1 })).get('syn-a')).toBe('NOT-RUN');
  });

  it('a failed file never hides a red elsewhere: a failing bound test in a passed-status file stays REGRESSED', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'red [finding:syn-a]', status: 'failed' }]);
    j.success = false;
    j.testResults.push({ name: '/abs/tests/other.test.ts', status: 'failed', assertionResults: [] });
    expect(statusById(collectVitest(j, undefined, { runExitCode: 1 })).get('syn-a')).toBe('REGRESSED');
  });

  it('a file entry without a status is rejected (cannot tell whether it completed)', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'ok [finding:syn-a]', status: 'passed' }]);
    delete (j.testResults[0] as { status?: string }).status;
    expect(() => collectVitest(j)).toThrow(VitestReportError);
  });

  // Vitest 4.1.7's JSON reporter computes `success` from failed tests/suites only; an unhandled error
  // leaves `success: true` and every file `passed`, and shows up ONLY in the runner's exit status.
  it('a non-zero runner exit with an all-green report (an unhandled error) makes every pass NOT-RUN', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'ok [finding:syn-a]', status: 'passed' }]);
    expect(j.success).toBe(true);
    expect(statusById(collectVitest(j, undefined, { runExitCode: 1 })).get('syn-a')).toBe('NOT-RUN');
  });

  it('runner exit 0 with an all-green report keeps a pass FIXED-VERIFIED', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'ok [finding:syn-a]', status: 'passed' }]);
    expect(statusById(collectVitest(j, undefined, { runExitCode: 0 })).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('runner exit 0 contradicting a failed file is rejected (the report and the exit code disagree)', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'red [finding:syn-a]', status: 'failed' }]);
    j.success = false;
    j.testResults[0]!.status = 'failed';
    expect(() => collectVitest(j, undefined, { runExitCode: 0 })).toThrow(VitestReportError);
  });

  it('a non-zero runner exit never hides a red: a failing bound test stays REGRESSED', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'red [finding:syn-a]', status: 'failed' }]);
    j.success = false;
    j.testResults[0]!.status = 'failed';
    expect(statusById(collectVitest(j, undefined, { runExitCode: 1 })).get('syn-a')).toBe('REGRESSED');
  });

  it('input that is not a vitest JSON report is rejected loudly', () => {
    expect(() => collectVitest({ suites: [] })).toThrow(VitestReportError);
  });
});

// Round-7 class: a Vitest run failure must reach REPORT-level distrust. The JSON cannot attribute every
// failure (unhandled errors are absent; a file that fails to load has no assertions, so the tagged checks
// in it never appear), so ANY failed run untrusts the whole report, not just Vitest's own passes.
describe('collectVitestReport: a failed run untrusts the whole report', () => {
  const pass = { ancestorTitles: ['s'], title: 'ok [finding:syn-a]', status: 'passed' };

  it('a file that failed before discovery (no assertions) → untrusted, naming the file', () => {
    const r = vitestJson([pass]);
    r.success = false;
    r.testResults.push({
      name: '/abs/tests/broken.test.ts',
      status: 'failed',
      message: 'SyntaxError',
      assertionResults: [],
    });
    const out = collectVitestReport(r, undefined, { runExitCode: 1 });
    expect(out.untrusted.join('\n')).toContain('broken.test.ts');
  });

  it('a green report with a non-zero exit (unhandled error) → untrusted', () => {
    expect(collectVitestReport(vitestJson([pass]), undefined, { runExitCode: 1 }).untrusted.length).toBeGreaterThan(0);
  });

  it('a failing TAGGED assertion still untrusts the report (the same run may hide an unhandled error)', () => {
    const r = vitestJson([pass, { ancestorTitles: ['s'], title: 'b [finding:syn-b]', status: 'failed' }]);
    r.success = false;
    r.testResults[0]!.status = 'failed';
    const out = collectVitestReport(r, undefined, { runExitCode: 1 });
    expect(out.untrusted.length).toBeGreaterThan(0);
    expect(statusById(out.observations).get('syn-b')).toBe('REGRESSED');
  });

  it('a clean run (exit 0, every file passed) is trusted', () => {
    const out = collectVitestReport(vitestJson([pass]), undefined, { runExitCode: 0 });
    expect(out.untrusted).toEqual([]);
    expect(statusById(out.observations).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('no exit status at all → untrusted (the JSON alone cannot show an unhandled error)', () => {
    expect(collectVitestReport(vitestJson([pass])).untrusted).toEqual([
      'vitest: no run exit status; the JSON alone cannot show an unhandled error',
    ]);
  });
});

// Round-9 class: Vitest's `test.fails` inverts the result — the body THROWS and the test reports
// `passed`, exit 0. The stock JSON reporter omits the flag, so the harness requires its own reporter
// (scripts/reaudit/vitest-json-reporter.ts), which adds `fails` per assertion and a marker.
describe('collectVitest: test.fails and the reaudit reporter', () => {
  it('a bound test.fails test that "passed" is NEVER FIXED-VERIFIED (NOT-RUN)', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'ideal [finding:syn-a]', status: 'passed', fails: true }]);
    expect(statusById(collectVitest(j, undefined, { runExitCode: 0 })).get('syn-a')).toBe('NOT-RUN');
  });

  it('a test.fails test bound only by a private name binding is NOT-RUN too', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'plain', status: 'passed', fails: true }]);
    const b = new Map([['s plain', ['syn-a']]]);
    expect(statusById(collectVitest(j, b, { runExitCode: 0 })).get('syn-a')).toBe('NOT-RUN');
  });

  it('an ordinary passing bound test stays FIXED-VERIFIED', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'ideal [finding:syn-a]', status: 'passed', fails: false }]);
    expect(statusById(collectVitest(j, undefined, { runExitCode: 0 })).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('a stock Vitest JSON report (no reaudit marker) is rejected: it cannot show test.fails', () => {
    const j: Record<string, unknown> = vitestJson([
      { ancestorTitles: ['s'], title: 'x [finding:syn-a]', status: 'passed' },
    ]);
    delete j.reaudit;
    expect(() => collectVitest(j)).toThrow(/vitest-json-reporter/);
  });

  it('an assertion without the fails flag is rejected', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'x [finding:syn-a]', status: 'passed' }]);
    delete (j.testResults[0]!.assertionResults[0] as { fails?: boolean }).fails;
    expect(() => collectVitest(j)).toThrow(VitestReportError);
  });
});

// Evidence comes only from a COMPLETE, UNFILTERED run (canonical.ts). The reaudit reporter records the
// run's active filters, whether `.only` was allowed, and every test file Vitest's glob selects; the
// collector refuses a report that is filtered or does not hold every one of those files.
describe('collectVitestReport: only a complete, unfiltered run is evidence', () => {
  const twoFiles = (bStatus = 'passed') => {
    const j = vitestJson([{ ancestorTitles: ['security'], title: 'denies cross-org read', status: 'passed' }]);
    j.testResults[0]!.name = '/abs/tests/a.test.ts';
    j.testResults.push({
      name: '/abs/tests/b.test.ts',
      status: bStatus,
      message: undefined,
      assertionResults: [
        {
          ancestorTitles: ['security'],
          title: 'denies cross-org read',
          status: bStatus,
          fails: false,
          fullName: 'security denies cross-org read',
        },
      ],
    });
    return j;
  };
  const priv = new Map([['security denies cross-org read', ['syn-private']]]);

  it('Codex r15: the same private full name in two files, one file omitted from the run → refused', () => {
    const j = twoFiles();
    j.testResults.pop();
    j.reaudit.run = { ...j.reaudit.run, modules: ['/abs/tests/a.test.ts', '/abs/tests/b.test.ts'] };
    expect(() => collectVitestReport(j, priv, { runExitCode: 0 })).toThrow(/b\.test\.ts/);
    expect(() => collectVitestReport(j, priv, { runExitCode: 0 })).toThrow(VitestReportError);
  });

  it('control: both files in the run, the omitted one failing → REGRESSED (a sibling pass cannot mask it)', () => {
    const vt = collectVitestReport(twoFiles('failed'), priv, { runExitCode: 1 });
    expect(statusById(vt.observations).get('syn-private')).toBe('REGRESSED');
  });

  it('a file in the report that Vitest’s glob did not select is refused too (the counts must reconcile)', () => {
    const j = twoFiles();
    j.reaudit.run = { ...j.reaudit.run, modules: ['/abs/tests/a.test.ts'] };
    expect(() => collectVitestReport(j, priv, { runExitCode: 0 })).toThrow(VitestReportError);
  });

  it('the same file run by two projects must appear twice (a multiset, not a set)', () => {
    const j = twoFiles();
    j.reaudit.run = {
      ...j.reaudit.run,
      modules: ['/abs/tests/a.test.ts', '/abs/tests/a.test.ts', '/abs/tests/b.test.ts'],
    };
    expect(() => collectVitestReport(j, priv, { runExitCode: 0 })).toThrow(VitestReportError);
  });

  it('a run with any active filter is refused, naming it', () => {
    for (const filter of ['-t syn-a', 'files tests/a.test.ts', '--project node', '--shard 1/2']) {
      const j = twoFiles();
      j.reaudit.run = { ...j.reaudit.run, filters: [filter] };
      expect(() => collectVitestReport(j, priv, { runExitCode: 0 })).toThrow(filter);
    }
  });

  it('a run that allowed `.only` is refused (record.ts sets CI=true, which makes Vitest refuse .only)', () => {
    const j = twoFiles();
    j.reaudit.run = { ...j.reaudit.run, allowOnly: true };
    expect(() => collectVitestReport(j, priv, { runExitCode: 0 })).toThrow(/only/);
  });

  it('a report without the run record (an older reaudit reporter) is refused', () => {
    const j = twoFiles() as unknown as { reaudit: Record<string, unknown> };
    delete j.reaudit.run;
    expect(() => collectVitestReport(j, priv, { runExitCode: 0 })).toThrow(VitestReportError);
  });
});
