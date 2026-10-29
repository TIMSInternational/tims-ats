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
 * (an unhandled error sets `success: false`). A pass from such a file, or from such a run, is not
 * trusted evidence and becomes NOT-RUN. A failing assertion is never downgraded.
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

export function collectVitest(raw: unknown, extraNameBindings?: ReadonlyMap<string, readonly string[]>): Observation[] {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success)
    throw new VitestReportError('not a vitest JSON report (expected testResults[].status and .assertionResults[])');
  const out: Observation[] = [];
  const seen = new Set<string>();
  const anyFileFailed = parsed.data.testResults.some((f) => f.status === 'failed');
  const runFailedUnexplained = parsed.data.success === false && !anyFileFailed;
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
