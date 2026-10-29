/**
 * Collects per-finding observations from a Vitest JSON report written by the harness's own reporter:
 *
 *   npx vitest run --reporter=./scripts/reaudit/vitest-json-reporter.ts --outputFile=<abs path>
 *
 * That reporter is the stock JSON reporter plus `fails` on every assertion and a top-level `reaudit`
 * marker. `test.fails` inverts a result (the body throws, the test reports `passed`, exit 0) and the
 * stock report omits the flag, so a stock report is rejected and a bound `test.fails` test is NOT-RUN,
 * never FIXED-VERIFIED.
 *
 * ONLY A COMPLETE, UNFILTERED RUN IS EVIDENCE. The reporter also records the run (`reaudit.run`): its
 * active filters, whether `.only` was allowed, and every test file Vitest's own glob selects. A report
 * with any filter, with `.only` allowed, or whose files are not exactly the globbed files (a multiset:
 * once per project) is refused, so no bound check can be left out of the run while a sibling passes.
 *
 * A test binds when its FULL name (every ancestor describe title + the leaf title) contains
 * `[finding:<slug>]`. Private bindings may additionally bind an untagged test by its exact full name.
 * A private binding whose test is absent from the report (renamed, deleted, filtered out) yields
 * NOT-RUN for its id.
 *
 * A file can fail OUTSIDE its assertions (a throwing afterAll leaves the file `failed` with an empty
 * message while every assertion still reads `passed`), and a run can fail with no failed file at all
 * (`success: false`). A pass from such a run is not trusted evidence and becomes NOT-RUN. A failing
 * assertion is never downgraded.
 *
 * The JSON report CANNOT show an unhandled error: Vitest 4.1.7's reporter computes `success` from
 * failed tests and suites only, so a run with an unhandled error reports every file `passed` and
 * `success: true`. Only the runner's exit status carries it. Pass that status as `runExitCode`; a
 * non-zero exit makes every pass NOT-RUN, and exit 0 alongside a failed file is a contradiction and is
 * rejected. The CLI requires it (`--vitest-exit`).
 *
 * When a file genuinely failed, the non-zero exit is already explained, so an unhandled error in the
 * same run cannot be ruled out. Passes in OTHER, passed files are therefore distrusted as well: any
 * failed run (failed file, `success: false`, or non-zero exit) makes every pass in it NOT-RUN.
 *
 * Nor can a failure be attributed to a binding: a file that fails to load has no assertions, so the
 * tagged checks in it never appear. collectVitestReport therefore returns an untrusted-run reason for
 * ANY failed run (and for a missing exit status), which the report applies to every source: no
 * finding is FIXED-VERIFIED and --gate launch fails.
 */
import { z } from 'zod';
import { tagIds, type Collection, type Observation, type ObservedStatus } from './status';

export { tagIds };

export class VitestReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VitestReportError';
  }
}

const assertionSchema = z.object({
  ancestorTitles: z.array(z.string().max(2000)),
  title: z.string().max(2000),
  status: z.string().max(50),
  fails: z.boolean(),
});
export const VITEST_REPORT_MARKER = { reporter: 'reaudit-vitest-json', version: 2 } as const;
const runSchema = z
  .object({
    filters: z.array(z.string().max(4096)).max(100),
    allowOnly: z.boolean(),
    modules: z.array(z.string().max(4096)).max(20000),
  })
  .strict();
const reportSchema = z.object({
  reaudit: z
    .object({ reporter: z.literal(VITEST_REPORT_MARKER.reporter), version: z.literal(2), run: runSchema })
    .strict(),
  success: z.boolean().optional(),
  testResults: z.array(
    z.object({
      name: z.string().max(4096).optional(),
      status: z.string().max(50),
      assertionResults: z.array(assertionSchema),
    }),
  ),
});
const STALE = new Set(['skipped', 'todo', 'pending', 'disabled']);

function statusFor(status: string): ObservedStatus {
  if (status === 'passed') return 'FIXED-VERIFIED';
  if (status === 'failed') return 'REGRESSED';
  if (STALE.has(status)) return 'STALE-BINDING';
  return 'NOT-RUN';
}

export interface VitestRunOptions {
  /** The `vitest run` process exit status. Undefined only for callers with no process (unit tests). */
  runExitCode?: number;
}

/** Refuses a filtered run, one that allowed `.only`, and one whose files are not every globbed file. */
function assertComplete(report: z.infer<typeof reportSchema>): void {
  const { filters, allowOnly, modules } = report.reaudit.run;
  if (filters.length > 0) {
    throw new VitestReportError(`a filtered Vitest run is not evidence (${filters.join('; ')}); run the full suite`);
  }
  if (allowOnly) {
    throw new VitestReportError('the Vitest run allowed .only, so it may have skipped bound tests; run with CI=true');
  }
  const ran = report.testResults.map((f) => f.name ?? '(unnamed file)');
  const missing = multisetMinus(modules, ran);
  const extra = multisetMinus(ran, modules);
  if (missing.length || extra.length) {
    throw new VitestReportError(
      'the Vitest report does not hold exactly the files the run selected' +
        (missing.length ? `; not reported: ${missing.slice(0, 20).join(', ')}` : '') +
        (extra.length ? `; not selected: ${extra.slice(0, 20).join(', ')}` : ''),
    );
  }
}

/** Items of `a` left after removing one occurrence per item of `b`. */
function multisetMinus(a: readonly string[], b: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const n = counts.get(x) ?? 0;
    if (n > 0) counts.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

export function collectVitest(
  raw: unknown,
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
  opts: VitestRunOptions = {},
): Observation[] {
  return collectVitestReport(raw, extraNameBindings, opts).observations;
}

export function collectVitestReport(
  raw: unknown,
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
  opts: VitestRunOptions = {},
): Collection {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const raw0 = raw as { reaudit?: unknown } | null;
    if (raw0 && typeof raw0 === 'object' && !('reaudit' in raw0)) {
      throw new VitestReportError(
        'a stock Vitest JSON report cannot show test.fails; run Vitest with ' +
          '--reporter=./scripts/reaudit/vitest-json-reporter.ts',
      );
    }
    const first = parsed.error.issues[0];
    throw new VitestReportError(
      `not a reaudit Vitest JSON report (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid'})`,
    );
  }
  assertComplete(parsed.data);
  const out: Observation[] = [];
  const seen = new Set<string>();
  const anyFileFailed = parsed.data.testResults.some((f) => f.status === 'failed');
  const exit = opts.runExitCode;
  if (exit === 0 && (anyFileFailed || parsed.data.success === false)) {
    throw new VitestReportError('vitest exited 0 but the report shows a failure; the report and exit code disagree');
  }
  const untrusted = anyFileFailed || parsed.data.success === false || (exit !== undefined && exit !== 0);
  for (const file of parsed.data.testResults) {
    for (const a of file.assertionResults) {
      const fullName = [...a.ancestorTitles, a.title].join(' ');
      seen.add(fullName);
      const ids = tagIds(fullName);
      for (const extra of extraNameBindings?.get(fullName) ?? []) if (!ids.includes(extra)) ids.push(extra);
      // A test.fails "pass" means the body threw: never evidence that the ideal holds.
      const raw = a.fails ? 'NOT-RUN' : statusFor(a.status);
      const status = untrusted && raw === 'FIXED-VERIFIED' ? 'NOT-RUN' : raw;
      for (const id of ids) out.push({ id, status, source: 'vitest', test: fullName });
    }
  }
  for (const [name, ids] of extraNameBindings ?? []) {
    if (seen.has(name)) continue;
    for (const id of ids) out.push({ id, status: 'NOT-RUN', source: 'vitest', test: name });
  }
  const reasons: string[] = [];
  if (exit === undefined) reasons.push('vitest: no run exit status; the JSON alone cannot show an unhandled error');
  else if (exit !== 0) reasons.push(`vitest: the run exited ${exit}`);
  if (parsed.data.success === false) reasons.push('vitest: the report says success: false');
  for (const f of parsed.data.testResults) {
    if (f.status === 'failed') reasons.push(`vitest: ${f.name ?? '(unnamed file)'} failed`);
  }
  return { observations: out, untrusted: reasons };
}
