import { describe, it, expect } from 'vitest';
import { collectPlaywright, PlaywrightReportError } from './collect-playwright';
import { statusById } from './status';

// Contract with e2e/lib/findings.ts (PR-4): `expectIdeal(id)` pushes an annotation
//   { type: 'finding-open',  description: id }  when the id is open and the ideal did NOT hold, or
//   { type: 'finding-fixed', description: id }  when the id is fixed and the ideal assertion ran.
// `requires(id)` pushes `finding-requires` and then calls test.fixme(). The JSON report is the
// Playwright 1.6x `json` reporter output. Shapes below are minimal but structurally faithful.

type Annotation = { type: string; description?: string };
type Result = { retry: number; status: string; annotations?: Annotation[] };

function testEntry(opts: { annotations?: Annotation[]; results: Result[]; expectedStatus?: string }) {
  return {
    projectName: 'recruiter',
    expectedStatus: opts.expectedStatus ?? 'passed',
    annotations: opts.annotations ?? [],
    results: opts.results,
  };
}

function report(tests: ReturnType<typeof testEntry>[], nested = false) {
  const specs = tests.map((t, i) => ({ title: `step ${i}`, tests: [t] }));
  const inner = { title: 'J1 journey', file: 'recruiter/j1.spec.ts', specs, suites: [] };
  return {
    config: {},
    suites: nested ? [{ title: 'recruiter/j1.spec.ts', specs: [], suites: [inner] }] : [inner],
    errors: [],
    stats: {},
  };
}

const open = (id: string): Annotation => ({ type: 'finding-open', description: id });
const fixed = (id: string): Annotation => ({ type: 'finding-fixed', description: id });

describe('collectPlaywright: top-level (global) errors', () => {
  const globalError = { message: 'Error: globalTeardown failed', stack: 'Error: globalTeardown failed' };

  it('a pass in a report with a global error is NOT-RUN, never FIXED-VERIFIED', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] })]);
    (r.errors as unknown[]).push(globalError);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('NOT-RUN');
  });

  it('a global error never hides a red: a failed fixed-binding stays REGRESSED', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'failed' }] })]);
    (r.errors as unknown[]).push(globalError);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('REGRESSED');
  });

  it('an empty errors array leaves a pass FIXED-VERIFIED', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] })]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('a report without a top-level errors array is rejected (cannot tell whether the run errored)', () => {
    const r: Record<string, unknown> = report([
      testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
    ]);
    delete r.errors;
    expect(() => collectPlaywright(r)).toThrow(PlaywrightReportError);
  });
});

describe('collectPlaywright', () => {
  it('finding-open annotation on a passing test → OPEN-CONFIRMED', () => {
    const r = report([testEntry({ annotations: [open('syn-a')], results: [{ retry: 0, status: 'passed' }] })]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('OPEN-CONFIRMED');
  });

  it('finding-fixed annotation on a passing test → FIXED-VERIFIED', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] })]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('a failed test carrying a fixed id → REGRESSED', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'failed' }] })]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('REGRESSED');
  });

  it('a timed-out test carrying a fixed id → REGRESSED (timedOut is a failure)', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'timedOut' }] })]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('REGRESSED');
  });

  it('a fixme/skipped test bound to an id → STALE-BINDING', () => {
    const r = report([
      testEntry({
        expectedStatus: 'skipped',
        annotations: [{ type: 'finding-requires', description: 'syn-a' }, { type: 'fixme' }],
        results: [{ retry: 0, status: 'skipped' }],
      }),
    ]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('STALE-BINDING');
  });

  it('retries: the LAST attempt wins (failed then passed → FIXED-VERIFIED)', () => {
    const r = report([
      testEntry({
        annotations: [fixed('syn-a')],
        results: [
          { retry: 0, status: 'failed' },
          { retry: 1, status: 'passed' },
        ],
      }),
    ]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('retries: passed then failed → REGRESSED (last attempt, not first)', () => {
    const r = report([
      testEntry({
        annotations: [fixed('syn-a')],
        results: [
          { retry: 1, status: 'failed' },
          { retry: 0, status: 'passed' },
        ],
      }),
    ]);
    // Ordered by `retry`, not by array position.
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('REGRESSED');
  });

  it('reads annotations recorded on the last result as well as on the test', () => {
    const r = report([testEntry({ results: [{ retry: 0, status: 'passed', annotations: [open('syn-b')] }] })]);
    expect(statusById(collectPlaywright(r)).get('syn-b')).toBe('OPEN-CONFIRMED');
  });

  it('walks nested suites and records the full title path', () => {
    const r = report([testEntry({ annotations: [open('syn-a')], results: [{ retry: 0, status: 'passed' }] })], true);
    const obs = collectPlaywright(r);
    expect(obs).toHaveLength(1);
    expect(obs[0]?.source).toBe('playwright');
    expect(obs[0]?.test).toContain('J1 journey');
    expect(obs[0]?.test).toContain('step 0');
  });

  it('two steps on the same id, one regressed → REGRESSED for the id', () => {
    const r = report([
      testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
      testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'failed' }] }),
    ]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('REGRESSED');
  });

  it('a test with no finding annotation binds nothing', () => {
    const r = report([testEntry({ annotations: [{ type: 'issue' }], results: [{ retry: 0, status: 'passed' }] })]);
    expect(collectPlaywright(r)).toEqual([]);
  });

  it('finding-requires is never a pass: NOT-RUN when the test ran, STALE-BINDING when it was skipped', () => {
    const req = { type: 'finding-requires', description: 'syn-a' };
    const ran = report([testEntry({ annotations: [req], results: [{ retry: 0, status: 'passed' }] })]);
    expect(statusById(collectPlaywright(ran)).get('syn-a')).toBe('NOT-RUN');
    const skipped = report([
      testEntry({ annotations: [req], expectedStatus: 'skipped', results: [{ retry: 0, status: 'skipped' }] }),
    ]);
    expect(statusById(collectPlaywright(skipped)).get('syn-a')).toBe('STALE-BINDING');
  });

  it('a test with no results at all (never ran) binds as NOT-RUN, never as a pass', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [] })]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('NOT-RUN');
  });

  it('a finding annotation without a description is rejected loudly', () => {
    const r = report([
      testEntry({ annotations: [{ type: 'finding-open' }], results: [{ retry: 0, status: 'passed' }] }),
    ]);
    expect(() => collectPlaywright(r)).toThrow(PlaywrightReportError);
  });

  it('input that is not a Playwright JSON report is rejected loudly', () => {
    expect(() => collectPlaywright({ testResults: [] })).toThrow(PlaywrightReportError);
  });
});
