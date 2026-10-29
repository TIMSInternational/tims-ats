/**
 * Collects per-finding observations from a Playwright `json` reporter file.
 *
 * Contract with the journey helpers (e2e/lib/findings.ts, added later in WP-02):
 *   finding-open     <id>  the id is open and the ideal did NOT hold            -> OPEN-CONFIRMED
 *   finding-fixed    <id>  the id is fixed and the ideal assertion ran          -> FIXED-VERIFIED,
 *                          or REGRESSED when the test's final attempt failed
 *   finding-requires <id>  the step needs an unavailable dependency (test.fixme) -> STALE-BINDING
 *
 * Only the LAST attempt (highest `retry`) counts. A test that never produced a result is NOT-RUN,
 * and a skipped test bound to an id is STALE-BINDING — neither is ever a pass.
 *
 * Runtime annotations live on the attempt that pushed them, so a retry that fails before reaching
 * `expectIdeal` carries none. Bindings are therefore read from EVERY attempt. A binding that the final
 * attempt did not record has no trustworthy final evidence: a `finding-fixed` id is REGRESSED when the
 * final attempt failed, and anything else is NOT-RUN — never a pass, never OPEN-CONFIRMED.
 *
 * Top-level `errors` (global setup/teardown failures, errors outside any test) can coexist with
 * passing tests. A report with any such error is not trusted evidence of a pass: every FIXED-VERIFIED
 * becomes NOT-RUN. A failure is never downgraded. The `errors` array is required, so a report that
 * cannot say whether the run errored is rejected.
 */
import { z } from 'zod';
import { SLUG_RE, type Observation, type ObservedStatus } from './status';

export class PlaywrightReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaywrightReportError';
  }
}

const annotationSchema = z.object({ type: z.string().max(200), description: z.string().max(2000).optional() });
const resultSchema = z.object({
  retry: z.number().int().min(0),
  status: z.string().max(50),
  annotations: z.array(annotationSchema).optional(),
});
const testSchema = z.object({
  projectName: z.string().max(200).optional(),
  expectedStatus: z.string().max(50).optional(),
  annotations: z.array(annotationSchema).optional(),
  results: z.array(resultSchema),
});
const specSchema = z.object({ title: z.string().max(2000), tests: z.array(testSchema) });

interface Suite {
  title: string;
  specs?: z.infer<typeof specSchema>[];
  suites?: Suite[];
}

const suiteSchema: z.ZodType<Suite> = z.lazy(() =>
  z.object({
    title: z.string().max(2000),
    specs: z.array(specSchema).optional(),
    suites: z.array(suiteSchema).optional(),
  }),
);

const globalErrorSchema = z.object({ message: z.string().max(20000).optional() });
const reportSchema = z.object({ suites: z.array(suiteSchema), errors: z.array(globalErrorSchema) });

type PwTest = z.infer<typeof testSchema>;
type Annotation = z.infer<typeof annotationSchema>;

const FINDING_TYPES = new Set(['finding-open', 'finding-fixed', 'finding-requires']);
const FAILED = new Set(['failed', 'timedOut', 'interrupted']);

function findingAnnotations(annotations: readonly Annotation[], where: string): { type: string; id: string }[] {
  const out: { type: string; id: string }[] = [];
  for (const a of annotations) {
    if (!a.type.startsWith('finding-')) continue;
    if (!FINDING_TYPES.has(a.type)) {
      throw new PlaywrightReportError(`unknown finding annotation type "${a.type}" in ${where}`);
    }
    const id = a.description?.trim();
    if (!id || !SLUG_RE.test(id)) {
      throw new PlaywrightReportError(`annotation "${a.type}" in ${where} has no valid finding id as description`);
    }
    out.push({ type: a.type, id });
  }
  return out;
}

function statusFor(type: string, test: PwTest): ObservedStatus {
  const last = [...test.results].sort((a, b) => b.retry - a.retry)[0];
  if (!last) return 'NOT-RUN';
  if (last.status === 'skipped' || test.expectedStatus === 'skipped') return 'STALE-BINDING';
  if (type === 'finding-requires') return 'NOT-RUN';
  if (type === 'finding-open') return 'OPEN-CONFIRMED';
  if (FAILED.has(last.status)) return 'REGRESSED';
  if (last.status === 'passed') return 'FIXED-VERIFIED';
  return 'NOT-RUN';
}

function collectTest(test: PwTest, titlePath: string[], out: Observation[]): void {
  const name = [test.projectName ? `[${test.projectName}]` : '', titlePath.join(' › ')].filter(Boolean).join(' ');
  const [last, ...earlier] = [...test.results].sort((a, b) => b.retry - a.retry);
  const key = (type: string, id: string) => `${type}\u0000${id}`;
  const seen = new Set<string>();
  for (const { type, id } of findingAnnotations([...(test.annotations ?? []), ...(last?.annotations ?? [])], name)) {
    if (seen.has(key(type, id))) continue;
    seen.add(key(type, id));
    out.push({ id, status: statusFor(type, test), source: 'playwright', test: name });
  }
  const lastFailed = last !== undefined && FAILED.has(last.status);
  for (const { type, id } of findingAnnotations(
    earlier.flatMap((r) => r.annotations ?? []),
    name,
  )) {
    if (seen.has(key(type, id))) continue;
    seen.add(key(type, id));
    const status: ObservedStatus = type === 'finding-fixed' && lastFailed ? 'REGRESSED' : 'NOT-RUN';
    out.push({ id, status, source: 'playwright', test: name });
  }
}

function walk(suite: Suite, parents: string[], out: Observation[]): void {
  const path = suite.title ? [...parents, suite.title] : parents;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) collectTest(test, [...path, spec.title], out);
  }
  for (const child of suite.suites ?? []) walk(child, path, out);
}

export function collectPlaywright(raw: unknown): Observation[] {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PlaywrightReportError(
      `not a Playwright JSON report (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid'})`,
    );
  }
  const out: Observation[] = [];
  for (const suite of parsed.data.suites) walk(suite, [], out);
  if (parsed.data.errors.length === 0) return out;
  return out.map((o) => (o.status === 'FIXED-VERIFIED' ? { ...o, status: 'NOT-RUN' } : o));
}
