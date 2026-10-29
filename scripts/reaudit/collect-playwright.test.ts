import { describe, it, expect } from 'vitest';
import { collectPlaywright, collectPlaywrightReport, PlaywrightReportError } from './collect-playwright';
import { statusById } from './status';

// Contract with e2e/lib/findings.ts (PR-4):
//   BINDING (static, known before the test runs): the test declares `@finding:<id>` as a Playwright tag,
//   in its title or via `{ tag: '@finding:<id>' }` on the test or an enclosing describe. The JSON reporter
//   writes it to `spec.tags` (without the "@") for EVERY test, including failed, skipped and never-run ones.
//   EVIDENCE (runtime): `expectIdeal(id)` pushes
//   { type: 'finding-open',  description: id }  when the id is open and the ideal did NOT hold, or
//   { type: 'finding-fixed', description: id }  when the id is fixed and the ideal assertion ran.
// `requires(id)` pushes `finding-requires` and then calls test.fixme(). The JSON report is the
// Playwright 1.6x `json` reporter output. Shapes below are minimal but structurally faithful.

type Annotation = { type: string; description?: string };
type Result = { retry: number; status: string; annotations?: Annotation[] };
type Entry = ReturnType<typeof testEntry>;

/** Unless `tags` is given, a test declares exactly the ids its finding-open/finding-fixed annotations name. */
function testEntry(opts: { annotations?: Annotation[]; results: Result[]; expectedStatus?: string; tags?: string[] }) {
  const runtime = [...(opts.annotations ?? []), ...opts.results.flatMap((r) => r.annotations ?? [])];
  const declared = runtime
    .filter((a) => a.type === 'finding-open' || a.type === 'finding-fixed')
    .map((a) => `finding:${a.description ?? ''}`);
  return {
    tags: opts.tags ?? [...new Set(declared)],
    test: {
      projectName: 'recruiter',
      expectedStatus: opts.expectedStatus ?? 'passed',
      annotations: opts.annotations ?? [],
      results: opts.results,
    },
  };
}

function report(tests: Entry[], nested = false) {
  const specs = tests.map((t, i) => ({ title: `step ${i}`, tags: t.tags, tests: [t.test] }));
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

  // A runtime annotation is recorded on the attempt that pushed it. A retry that fails before reaching
  // the annotation must not erase the binding, or a sibling pass for the same id would win.
  it('retries: a fixed binding recorded only on an earlier attempt, final attempt failed → REGRESSED', () => {
    const r = report([
      testEntry({
        results: [
          { retry: 0, status: 'failed', annotations: [fixed('syn-a')] },
          { retry: 1, status: 'failed', annotations: [] },
        ],
      }),
      testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
    ]);
    const obs = collectPlaywright(r);
    expect(obs.filter((o) => o.id === 'syn-a').map((o) => o.status)).toContain('REGRESSED');
    expect(statusById(obs).get('syn-a')).toBe('REGRESSED');
  });

  it('retries: a binding recorded only on an earlier attempt, final attempt passed → NOT-RUN (never a pass)', () => {
    const r = report([
      testEntry({
        results: [
          { retry: 0, status: 'failed', annotations: [fixed('syn-a')] },
          { retry: 1, status: 'passed', annotations: [] },
        ],
      }),
    ]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('NOT-RUN');
  });

  it('retries: an open id recorded only on an earlier attempt, final attempt failed → REGRESSED, not OPEN-CONFIRMED', () => {
    // The tag binds the test; its final attempt failed, so the bound check failed.
    const r = report([
      testEntry({
        results: [
          { retry: 0, status: 'passed', annotations: [open('syn-a')] },
          { retry: 1, status: 'failed', annotations: [] },
        ],
      }),
    ]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('REGRESSED');
  });

  it('retries: a binding present on the final attempt keeps its normal status', () => {
    const r = report([
      testEntry({
        results: [
          { retry: 0, status: 'failed', annotations: [fixed('syn-a')] },
          { retry: 1, status: 'passed', annotations: [fixed('syn-a')] },
        ],
      }),
    ]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('FIXED-VERIFIED');
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

// Round-6 class: a binding that exists only at runtime is lost when the test fails before recording it,
// so a sibling pass wins. Bindings are therefore STATIC (`spec.tags`), and a failure whose binding cannot
// be determined (an untagged test) makes the whole report untrusted.
describe('collectPlaywright: static bindings and untrusted runs', () => {
  const tagged = (...ids: string[]) => ids.map((id) => `finding:${id}`);

  it('a tagged test that fails on its first attempt before any annotation → REGRESSED beats a sibling pass', () => {
    const r = report([
      testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
      testEntry({ tags: tagged('syn-a'), results: [{ retry: 0, status: 'failed' }] }),
    ]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('REGRESSED');
  });

  for (const status of ['failed', 'timedOut', 'interrupted']) {
    it(`an UNTAGGED ${status} test makes the report untrusted: a sibling pass is NOT-RUN and the reason names the test`, () => {
      const r = report([
        testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
        testEntry({ tags: [], results: [{ retry: 0, status }] }),
      ]);
      const out = collectPlaywrightReport(r);
      expect(statusById(out.observations).get('syn-a')).toBe('NOT-RUN');
      expect(out.untrusted.join('\n')).toContain('step 1');
    });
  }

  it('an untagged test that passed, was skipped, or never ran does not make the report untrusted', () => {
    const r = report([
      testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
      testEntry({ tags: [], results: [{ retry: 0, status: 'passed' }] }),
      testEntry({ tags: [], expectedStatus: 'skipped', results: [{ retry: 0, status: 'skipped' }] }),
      testEntry({ tags: [], results: [] }),
      testEntry({
        tags: [],
        results: [
          { retry: 0, status: 'failed' },
          { retry: 1, status: 'passed' },
        ],
      }),
    ]);
    const out = collectPlaywrightReport(r);
    expect(out.untrusted).toEqual([]);
    expect(statusById(out.observations).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('a global error is an untrusted-run reason too', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] })]);
    (r.errors as unknown[]).push({ message: 'Error: globalSetup failed' });
    expect(collectPlaywrightReport(r).untrusted.join('\n')).toMatch(/globalSetup failed/);
  });

  it('a non-zero Playwright exit with no failed test and no global error → untrusted (the JSON hides why)', () => {
    const r = report([testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] })]);
    const out = collectPlaywrightReport(r, { runExitCode: 1 });
    expect(out.untrusted.join('\n')).toMatch(/exit/);
    expect(statusById(out.observations).get('syn-a')).toBe('NOT-RUN');
  });

  it('a non-zero exit explained by a failed TAGGED test is not an extra untrusted reason', () => {
    const r = report([
      testEntry({ annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
      testEntry({ tags: tagged('syn-b'), results: [{ retry: 0, status: 'failed' }] }),
    ]);
    const out = collectPlaywrightReport(r, { runExitCode: 1 });
    expect(out.untrusted).toEqual([]);
    expect(statusById(out.observations).get('syn-a')).toBe('FIXED-VERIFIED');
    expect(statusById(out.observations).get('syn-b')).toBe('REGRESSED');
  });

  it('exit 0 with a failed test is a contradiction → rejected', () => {
    const r = report([testEntry({ tags: tagged('syn-a'), results: [{ retry: 0, status: 'failed' }] })]);
    expect(() => collectPlaywrightReport(r, { runExitCode: 0 })).toThrow(PlaywrightReportError);
  });

  it('a runtime finding-fixed annotation for an id the test does not declare as a tag → rejected', () => {
    const r = report([
      testEntry({ tags: tagged('syn-b'), annotations: [fixed('syn-a')], results: [{ retry: 0, status: 'passed' }] }),
    ]);
    expect(() => collectPlaywright(r)).toThrow(/syn-a/);
  });

  it('a runtime finding-open annotation for an undeclared id → rejected', () => {
    const r = report([
      testEntry({ tags: [], results: [{ retry: 0, status: 'passed', annotations: [open('syn-a')] }] }),
    ]);
    expect(() => collectPlaywright(r)).toThrow(PlaywrightReportError);
  });

  it('a tagged test that passed without recording finding-fixed on its final attempt → NOT-RUN', () => {
    const r = report([testEntry({ tags: tagged('syn-a'), results: [{ retry: 0, status: 'passed' }] })]);
    expect(statusById(collectPlaywright(r)).get('syn-a')).toBe('NOT-RUN');
  });

  it('a tagged test that never ran → NOT-RUN; a skipped one → STALE-BINDING (no annotation needed)', () => {
    const r = report([
      testEntry({ tags: tagged('syn-a'), results: [] }),
      testEntry({ tags: tagged('syn-b'), expectedStatus: 'skipped', results: [{ retry: 0, status: 'skipped' }] }),
    ]);
    const s = statusById(collectPlaywright(r));
    expect(s.get('syn-a')).toBe('NOT-RUN');
    expect(s.get('syn-b')).toBe('STALE-BINDING');
  });

  it('a spec without a tags array is rejected (bindings could not be determined), even with no annotations', () => {
    // No annotation in play, so only the required-tags rule can reject it (not the undeclared-id rule).
    const r = report([testEntry({ tags: [], results: [{ retry: 0, status: 'passed' }] })]);
    delete (r.suites[0]?.specs[0] as { tags?: string[] }).tags;
    expect(() => collectPlaywright(r)).toThrow(/tags/);
  });

  it('a finding tag with an invalid id is rejected loudly', () => {
    const r = report([testEntry({ tags: ['finding:Not A Slug'], results: [{ retry: 0, status: 'passed' }] })]);
    expect(() => collectPlaywright(r)).toThrow(PlaywrightReportError);
  });

  it('other tags are ignored', () => {
    const r = report([testEntry({ tags: ['smoke', 'slow'], results: [{ retry: 0, status: 'passed' }] })]);
    expect(collectPlaywright(r)).toEqual([]);
  });
});
