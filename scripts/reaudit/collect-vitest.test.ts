import { describe, it, expect } from 'vitest';
import { collectVitest, VitestReportError } from './collect-vitest';
import { statusById } from './status';

// Shape of `npx vitest run --reporter=json --outputFile=<f>` (jest-compatible JSON).
// A test binds when its FULL name (ancestor describe titles + leaf title) contains `[finding:<id>]`.

type Assertion = { ancestorTitles: string[]; title: string; status: string };

function vitestJson(assertions: Assertion[]): {
  numTotalTests: number;
  success: boolean;
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: (Assertion & { fullName: string })[];
  }[];
} {
  return {
    numTotalTests: assertions.length,
    success: true,
    testResults: [
      {
        name: '/abs/tests/synthetic.test.ts',
        status: 'passed',
        assertionResults: assertions.map((a) => ({
          ...a,
          fullName: [...a.ancestorTitles, a.title].join(' '),
        })),
      },
    ],
  };
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

  it('a pass in a PASSED file stays FIXED-VERIFIED when a different file failed', () => {
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
          fullName: 'o ok too [finding:syn-b]',
        },
      ],
    });
    const byId = statusById(collectVitest(j));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('NOT-RUN');
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
