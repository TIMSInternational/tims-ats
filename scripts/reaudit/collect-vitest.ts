/**
 * Collects per-finding observations from `vitest run --reporter=json` output.
 *
 * A test binds when its FULL name (every ancestor describe title + the leaf title) contains
 * `[finding:<slug>]`. Private bindings may additionally bind an untagged test by its exact full name.
 * A private binding whose test is absent from the report (renamed, deleted, filtered out) yields
 * NOT-RUN for its id, so a sibling binding's pass cannot mask a check that never ran.
 *
 * A file can fail OUTSIDE its assertions (a throwing afterAll leaves the file `failed` with an empty
 * message while every assertion still reads `passed`), and a run can fail with no failed file at all
 * (`success: false`). A pass from such a file, or from such a run, is not trusted evidence and becomes
 * NOT-RUN. A failing assertion is never downgraded.
 *
 * The JSON report CANNOT show an unhandled error: Vitest 4.1.7's reporter computes `success` from
 * failed tests and suites only, so a run with an unhandled error reports every file `passed` and
 * `success: true`. Only the runner's exit status carries it. Pass that status as `runExitCode`; a
 * non-zero exit with no failed file makes every pass NOT-RUN, and exit 0 alongside a failed file is a
 * contradiction and is rejected. The CLI requires it (`--vitest-exit`).
 *
 * Residual: when a file genuinely failed, the non-zero exit is already explained, so an unhandled
 * error in the same run is indistinguishable from that failure. Passes in OTHER passed files are kept.
 */
import { z } from 'zod';
import { tagIds, type Observation, type ObservedStatus } from './status';

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
});
const reportSchema = z.object({
  success: z.boolean().optional(),
  testResults: z.array(z.object({ status: z.string().max(50), assertionResults: z.array(assertionSchema) })),
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

export function collectVitest(
  raw: unknown,
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
  opts: VitestRunOptions = {},
): Observation[] {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success)
    throw new VitestReportError('not a vitest JSON report (expected testResults[].status and .assertionResults[])');
  const out: Observation[] = [];
  const seen = new Set<string>();
  const anyFileFailed = parsed.data.testResults.some((f) => f.status === 'failed');
  const exit = opts.runExitCode;
  if (exit === 0 && (anyFileFailed || parsed.data.success === false)) {
    throw new VitestReportError('vitest exited 0 but the report shows a failure; the report and exit code disagree');
  }
  const runFailedUnexplained = (parsed.data.success === false || (exit !== undefined && exit !== 0)) && !anyFileFailed;
  for (const file of parsed.data.testResults) {
    const untrusted = file.status === 'failed' || runFailedUnexplained;
    for (const a of file.assertionResults) {
      const fullName = [...a.ancestorTitles, a.title].join(' ');
      seen.add(fullName);
      const ids = tagIds(fullName);
      for (const extra of extraNameBindings?.get(fullName) ?? []) if (!ids.includes(extra)) ids.push(extra);
      const raw = statusFor(a.status);
      const status = untrusted && raw === 'FIXED-VERIFIED' ? 'NOT-RUN' : raw;
      for (const id of ids) out.push({ id, status, source: 'vitest', test: fullName });
    }
  }
  for (const [name, ids] of extraNameBindings ?? []) {
    if (seen.has(name)) continue;
    for (const id of ids) out.push({ id, status: 'NOT-RUN', source: 'vitest', test: name });
  }
  return out;
}
