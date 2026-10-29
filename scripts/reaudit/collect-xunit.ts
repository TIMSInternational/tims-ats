/**
 * Collects per-finding observations from `dotnet test --logger trx` files.
 *
 * A test binds through a `[finding:<id>]` tag in its xUnit DisplayName
 * (`[Fact(DisplayName = "... [finding:<id>]")]`), the same convention as vitest titles. The VSTest
 * TRX logger (verified on 17.14.1 with xunit.runner.visualstudio 3.1.4, see
 * fixtures/vstest-17.14.1-xunit-3.1.4.trx) writes the DisplayName as both the UnitTest `name` and the
 * result `testName`, and does NOT serialise xUnit traits, so `[Trait("Finding", ...)]` cannot bind.
 *
 * TRX is a small, fixed, machine-written dialect, so it is read with targeted patterns rather than a
 * general XML parser. Fail closed: a document without a closing `</TestRun>`, without a ResultSummary
 * outcome, with a run outcome other than Completed / Passed / Failed (an aborted, timed-out or crashed
 * run), or whose `<Counters total>` disagrees with its results is rejected. A tagged definition with no
 * result, and a private binding whose test is absent from every file read, yield NOT-RUN, so a sibling
 * binding's pass cannot mask a check that never ran.
 *
 * A finished run can still carry a run-level failure. The xUnit adapter writes one `Error` RunInfo per
 * failed test (`<name> [FAIL]`); any other `Error` RunInfo, or a `Failed` summary with no failing
 * result, is unexplained, and every pass in that file is downgraded to NOT-RUN.
 *
 * `dotnet test` over several projects writes one TRX per project that RAN: a project that fails to build
 * or crashes before its logger runs writes none, and only the exit status shows it. collectXunitRun
 * therefore returns an untrusted-run reason for ANY failed run (non-zero exit, a failing result, an
 * unexplained run-level failure, or no exit status), which the report applies to every source. Exit 0
 * alongside a failing result is a contradiction and is rejected.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tagIds, type Collection, type Observation, type ObservedStatus } from './status';

export class XunitReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XunitReportError';
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? '';
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1] as string] = decode(m[2] ?? '');
  return out;
}

function statusFor(outcome: string): ObservedStatus {
  if (outcome === 'Passed') return 'FIXED-VERIFIED';
  if (FAILING.has(outcome)) return 'REGRESSED';
  if (['NotExecuted', 'NotRunnable', 'Disconnected'].includes(outcome)) return 'STALE-BINDING';
  return 'NOT-RUN';
}

/** Run outcomes of a run that finished: every test it held reported. Anything else is not evidence. */
const FINISHED_RUN = new Set(['Completed', 'Passed', 'Failed']);

function assertComplete(xml: string, resultCount: number): string {
  if (!/<TestRun\b/.test(xml)) throw new XunitReportError('not a TRX document (no <TestRun> element)');
  if (!/<\/TestRun>\s*$/.test(xml)) {
    throw new XunitReportError('incomplete TRX document (no closing </TestRun>); an interrupted run is not evidence');
  }
  const outcome = /<ResultSummary\b[^>]*?\boutcome\s*=\s*"([^"]*)"/.exec(xml)?.[1];
  if (outcome === undefined) throw new XunitReportError('TRX has no ResultSummary outcome; cannot tell it finished');
  if (!FINISHED_RUN.has(outcome)) {
    throw new XunitReportError(`TRX run outcome is ${outcome}; an unfinished run is not evidence`);
  }
  const total = /<Counters\b[^>]*?\btotal\s*=\s*"(\d+)"/.exec(xml)?.[1];
  if (total !== undefined && Number(total) !== resultCount) {
    throw new XunitReportError(`TRX Counters total=${total} but the document holds ${resultCount} results`);
  }
  return outcome;
}

const FAILING = new Set(['Failed', 'Error', 'Timeout', 'Aborted']);

/** True when the run reports a failure that no failed result accounts for. */
function hasUnexplainedFailure(xml: string, runOutcome: string, failingNames: readonly string[]): boolean {
  if (runOutcome === 'Failed' && failingNames.length === 0) return true;
  for (const m of xml.matchAll(/<RunInfo\b([^>]*?)>([\s\S]*?)<\/RunInfo>/g)) {
    if (attrs(m[1] ?? '').outcome !== 'Error') continue;
    const text = decode(/<Text>([\s\S]*?)<\/Text>/.exec(m[2] ?? '')?.[1] ?? '');
    const explained = text.includes('[FAIL]') && failingNames.some((n) => n !== '' && text.includes(n));
    if (!explained) return true;
  }
  return false;
}

function idsFor(name: string, extraNameBindings: ReadonlyMap<string, readonly string[]> | undefined): string[] {
  const ids = tagIds(name);
  for (const extra of extraNameBindings?.get(name) ?? []) if (!ids.includes(extra)) ids.push(extra);
  return ids;
}

interface TrxStats {
  failing: number;
  /** Files whose run reports a failure no failed result explains. */
  unexplained: string[];
}

function readTrx(
  xml: string,
  extraNameBindings: ReadonlyMap<string, readonly string[]> | undefined,
  seen: Set<string>,
  stats: TrxStats = { failing: 0, unexplained: [] },
  where = 'TRX',
): Observation[] {
  const resultTags = [...xml.matchAll(/<UnitTestResult\b([^>]*?)\/?>/g)];
  const runOutcome = assertComplete(xml, resultTags.length);

  const definitions = new Map<string, string>();
  for (const m of xml.matchAll(/<UnitTest\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1] ?? '');
    if (a.id) definitions.set(a.id, a.name ?? '');
  }

  const results = resultTags.map((m) => {
    const a = attrs(m[1] ?? '');
    const name = (a.testId ? definitions.get(a.testId) : undefined) || a.testName || '';
    return { testId: a.testId, name, outcome: a.outcome ?? '' };
  });
  const failingNames = results.filter((r) => FAILING.has(r.outcome)).map((r) => r.name);
  const untrusted = hasUnexplainedFailure(xml, runOutcome, failingNames);
  stats.failing += failingNames.length;
  if (untrusted) stats.unexplained.push(where);

  const out: Observation[] = [];
  const reported = new Set<string>();
  for (const { testId, name, outcome } of results) {
    if (testId) reported.add(testId);
    seen.add(name);
    const raw = statusFor(outcome);
    const status = untrusted && raw === 'FIXED-VERIFIED' ? 'NOT-RUN' : raw;
    for (const id of idsFor(name, extraNameBindings)) out.push({ id, status, source: 'xunit', test: name });
  }
  for (const [testId, name] of definitions) {
    if (reported.has(testId)) continue;
    for (const id of tagIds(name)) out.push({ id, status: 'NOT-RUN', source: 'xunit', test: name });
  }
  return out;
}

function notRunBindings(
  extraNameBindings: ReadonlyMap<string, readonly string[]> | undefined,
  seen: ReadonlySet<string>,
): Observation[] {
  const out: Observation[] = [];
  for (const [name, ids] of extraNameBindings ?? []) {
    if (seen.has(name)) continue;
    for (const id of ids) out.push({ id, status: 'NOT-RUN', source: 'xunit', test: name });
  }
  return out;
}

export function collectXunitTrx(
  xml: string,
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
): Observation[] {
  const seen = new Set<string>();
  const out = readTrx(xml, extraNameBindings, seen);
  return [...out, ...notRunBindings(extraNameBindings, seen)];
}

export function collectXunitDir(
  dir: string,
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
): Observation[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new XunitReportError(`TRX directory not found: ${dir}`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.trx'))
    .sort();
  return collectXunitFiles(
    files.map((f) => ({ name: f, xml: readFileSync(join(dir, f), 'utf8') })),
    extraNameBindings,
    dir,
  );
}

/** Like collectXunitDir, over already-read (provenance-verified) contents. Only `.trx` names count. */
export function collectXunitFiles(
  files: readonly { name: string; xml: string }[],
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
  where = 'the TRX input',
): Observation[] {
  return readFiles(files, extraNameBindings, where).observations;
}

function readFiles(
  files: readonly { name: string; xml: string }[],
  extraNameBindings: ReadonlyMap<string, readonly string[]> | undefined,
  where: string,
): { observations: Observation[]; stats: TrxStats } {
  const trx = files.filter((f) => f.name.endsWith('.trx'));
  if (trx.length === 0) throw new XunitReportError(`no .trx files in ${where} (nothing ran is not a pass)`);
  const seen = new Set<string>();
  const stats: TrxStats = { failing: 0, unexplained: [] };
  const out = [...trx]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((f) => readTrx(f.xml, extraNameBindings, seen, stats, f.name));
  return { observations: [...out, ...notRunBindings(extraNameBindings, seen)], stats };
}

/** collectXunitFiles plus the run's exit status: any failed .NET run is an untrusted-run reason. */
export function collectXunitRun(
  files: readonly { name: string; xml: string }[],
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
  opts: { runExitCode?: number; where?: string } = {},
): Collection {
  const { observations, stats } = readFiles(files, extraNameBindings, opts.where ?? 'the TRX input');
  const exit = opts.runExitCode;
  if (exit === 0 && stats.failing > 0) {
    throw new XunitReportError(`dotnet test exited 0 but the TRX holds ${stats.failing} failing result(s)`);
  }
  const reasons: string[] = [];
  if (exit === undefined) reasons.push('xunit: no run exit status; a project that wrote no TRX cannot be ruled out');
  else if (exit !== 0) {
    reasons.push(`xunit: dotnet test exited ${exit} (a project that failed to build or crashed writes no TRX)`);
  }
  if (stats.failing > 0) reasons.push(`xunit: ${stats.failing} failing result(s)`);
  for (const f of stats.unexplained) reasons.push(`xunit: ${f} reports a run-level failure no result explains`);
  return { observations, untrusted: reasons };
}
