/**
 * Collects per-finding observations from a Playwright `json` reporter file.
 *
 * BINDING is static. A test is bound to a finding when it declares the Playwright tag `@finding:<id>`
 * (in its title, or `{ tag }` on the test or an enclosing describe). The JSON reporter writes tags to
 * `spec.tags` for every test, including tests that failed before doing anything, were skipped or never
 * ran, so a binding cannot be lost by a test failing early. `spec.tags` is required.
 *
 * EVIDENCE is runtime, from the journey helpers (e2e/lib/findings.ts, PR-4), read from the FINAL attempt:
 *   finding-open     <id>  the id is open and the ideal did NOT hold            -> OPEN-CONFIRMED
 *   finding-fixed    <id>  the id is fixed and the ideal assertion ran          -> FIXED-VERIFIED
 *   finding-requires <id>  the step needs an unavailable dependency (test.fixme) -> STALE-BINDING / NOT-RUN
 * A finding-open / finding-fixed annotation for an id the test does not declare as a tag is a broken
 * contract and rejects the report.
 *
 * Per tagged id, from the final attempt (highest `retry`): no result -> NOT-RUN; skipped -> STALE-BINDING;
 * a `test.fail()` test (expectedStatus `failed`) -> NOT-RUN whatever happened (never a pass);
 * failed / timedOut / interrupted -> REGRESSED (OPEN-CONFIRMED if the final attempt recorded finding-open
 * for it); passed -> FIXED-VERIFIED with finding-fixed, OPEN-CONFIRMED with finding-open, else NOT-RUN.
 *
 * An UNEXPECTED outcome is Playwright's own notion: the final status differs from `expectedStatus`
 * (a `test.fail()` test that fails is expected; one that passes, or times out, is not).
 *
 * UNTRUSTED RUN. The report is untrusted when (a) any test with NO finding tag had an unexpected outcome
 * (its binding cannot be determined, so it may be the check for any id), (b) the report has top-level
 * `errors` (global setup/teardown), or (c) the run's exit status is non-zero and no unexpected outcome
 * explains it. Then every FIXED-VERIFIED becomes NOT-RUN and the reasons are returned, so the CLI can
 * distrust every source and fail the launch gate. A failure is never downgraded. Exit 0 alongside an
 * unexpected outcome is a contradiction and rejects the report.
 */
import { z } from 'zod';
import { posix } from 'node:path';
import { repoRelative, SLUG_RE, type Collection, type Observation, type ObservedStatus } from './status';

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
const specSchema = z.object({
  title: z.string().max(2000),
  /** Relative to the Playwright config's rootDir. Optional: without it no inventory entry can match. */
  file: z.string().max(4096).optional(),
  tags: z.array(z.string().max(500)).max(200),
  tests: z.array(testSchema),
});

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
/** `config.rootDir` (absolute, at the time of the run): `spec.file` is relative to it. */
const reportSchema = z.object({
  config: z.object({ rootDir: z.string().max(4096).optional() }).optional(),
  suites: z.array(suiteSchema),
  errors: z.array(globalErrorSchema),
});

type PwTest = z.infer<typeof testSchema>;
type PwSpec = z.infer<typeof specSchema>;
type Annotation = z.infer<typeof annotationSchema>;

const FINDING_TYPES = new Set(['finding-open', 'finding-fixed', 'finding-requires']);
const FAILED = new Set(['failed', 'timedOut', 'interrupted']);
const TAG_PREFIX = 'finding:';

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

/** The ids a spec declares with `@finding:<id>` tags (the JSON reporter strips the "@"). */
function taggedIds(spec: PwSpec, where: string): string[] {
  const ids: string[] = [];
  for (const tag of spec.tags) {
    const t = tag.replace(/^@/, '');
    if (!t.startsWith(TAG_PREFIX)) continue;
    const id = t.slice(TAG_PREFIX.length);
    if (!SLUG_RE.test(id)) throw new PlaywrightReportError(`tag "${tag}" in ${where} has no valid finding id`);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

interface Walked {
  observations: Observation[];
  /** Tests with an unexpected outcome and no finding tag. */
  unboundFailures: string[];
  anyUnexpected: boolean;
  checkoutRoot?: string;
  rootDir?: string;
}

function statusFor(
  id: string,
  last: PwTest['results'][number] | undefined,
  test: PwTest,
  evidence: Set<string>,
): ObservedStatus {
  if (!last) return 'NOT-RUN';
  if (last.status === 'skipped' || test.expectedStatus === 'skipped') return 'STALE-BINDING';
  if (test.expectedStatus === 'failed') return 'NOT-RUN';
  if (evidence.has(`finding-open\u0000${id}`)) return 'OPEN-CONFIRMED';
  if (FAILED.has(last.status)) return 'REGRESSED';
  if (last.status === 'passed' && evidence.has(`finding-fixed\u0000${id}`)) return 'FIXED-VERIFIED';
  return 'NOT-RUN';
}

/** `titlePath[0]` is the file suite's title; the key name is the path below it (see inventory-scan.ts). */
function collectTest(spec: PwSpec, test: PwTest, titlePath: string[], acc: Walked): void {
  const name = [test.projectName ? `[${test.projectName}]` : '', titlePath.join(' › ')].filter(Boolean).join(' ');
  const ids = taggedIds(spec, name);
  const last = [...test.results].sort((a, b) => b.retry - a.retry)[0];
  const expected = test.expectedStatus ?? 'passed';
  const unexpected =
    last !== undefined && last.status !== expected && !(last.status === 'skipped' || expected === 'skipped');
  if (unexpected) acc.anyUnexpected = true;
  if (unexpected && ids.length === 0) acc.unboundFailures.push(`${name} (${last?.status}, expected ${expected})`);

  // Every runtime finding-open / finding-fixed, on any attempt, must name a declared id.
  const everyAttempt = [...(test.annotations ?? []), ...test.results.flatMap((r) => r.annotations ?? [])];
  for (const { type, id } of findingAnnotations(everyAttempt, name)) {
    if (type !== 'finding-requires' && !ids.includes(id)) {
      throw new PlaywrightReportError(
        `${name} records "${type}" for ${id} but does not declare the tag @finding:${id}: bindings must be static`,
      );
    }
  }
  const finalAnnotations = findingAnnotations([...(test.annotations ?? []), ...(last?.annotations ?? [])], name);
  const evidence = new Set(finalAnnotations.map((a) => `${a.type}\u0000${a.id}`));
  const abs = acc.rootDir && spec.file ? posix.join(acc.rootDir.replace(/\\/g, '/'), spec.file) : undefined;
  const key = { file: repoRelative(acc.checkoutRoot, abs), name: titlePath.slice(1).join(' › ') };
  for (const id of ids) {
    acc.observations.push({ id, status: statusFor(id, last, test, evidence), source: 'playwright', test: name, key });
  }

  // `requires()` names a dependency, not the test's own binding: it is never a pass.
  for (const { id } of finalAnnotations.filter((a) => a.type === 'finding-requires')) {
    if (ids.includes(id)) continue;
    const skipped = last !== undefined && (last.status === 'skipped' || test.expectedStatus === 'skipped');
    acc.observations.push({ id, status: skipped ? 'STALE-BINDING' : 'NOT-RUN', source: 'playwright', test: name });
  }
}

function walk(suite: Suite, parents: string[], acc: Walked): void {
  const path = suite.title ? [...parents, suite.title] : parents;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) collectTest(spec, test, [...path, spec.title], acc);
  }
  for (const child of suite.suites ?? []) walk(child, path, acc);
}

export type PlaywrightCollection = Collection;

export function collectPlaywrightReport(
  raw: unknown,
  opts: { runExitCode?: number; checkoutRoot?: string } = {},
): PlaywrightCollection {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PlaywrightReportError(
      `not a Playwright JSON report (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid'})`,
    );
  }
  const acc: Walked = {
    observations: [],
    unboundFailures: [],
    anyUnexpected: false,
    checkoutRoot: opts.checkoutRoot,
    rootDir: parsed.data.config?.rootDir,
  };
  for (const suite of parsed.data.suites) walk(suite, [], acc);

  const untrusted: string[] = acc.unboundFailures.map(
    (t) => `playwright: ${t}: an unexpected outcome in a test with no @finding tag`,
  );
  for (const e of parsed.data.errors) {
    untrusted.push(`playwright: global error: ${(e.message ?? '(no message)').split('\n')[0]}`);
  }
  const exit = opts.runExitCode;
  if (exit === 0 && acc.anyUnexpected) {
    throw new PlaywrightReportError('the Playwright run exited 0 but its report has an unexpected outcome');
  }
  if (exit !== undefined && exit !== 0 && !acc.anyUnexpected && parsed.data.errors.length === 0) {
    untrusted.push(`playwright: the run exited ${exit} but its report shows no failure`);
  }
  if (untrusted.length === 0) return { observations: acc.observations, untrusted };
  const observations = acc.observations.map((o) =>
    o.status === 'FIXED-VERIFIED' ? { ...o, status: 'NOT-RUN' as const } : o,
  );
  return { observations, untrusted };
}

/** Observations only (see collectPlaywrightReport for the untrusted-run reasons). */
export function collectPlaywright(raw: unknown, opts: { runExitCode?: number } = {}): Observation[] {
  return collectPlaywrightReport(raw, opts).observations;
}
