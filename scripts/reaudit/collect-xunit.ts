/**
 * Collects per-finding observations from `dotnet test --logger trx` files.
 *
 * A test binds through `[Trait("Finding", "<id>")]`, which the TRX logger writes as
 * `<Property><Key>Finding</Key><Value>id</Value></Property>` inside the UnitTest definition's
 * `<Properties>`. Results are joined to definitions by `testId`. TRX is a small, fixed, machine-
 * written dialect, so it is read with targeted patterns rather than a general XML parser. Because of
 * that, an incomplete document (no closing `</TestRun>`, e.g. an interrupted run) is rejected, and so
 * is one whose `<Counters total>` disagrees with the results it contains. A private binding whose test
 * is absent from every file read yields NOT-RUN, so a sibling binding's pass cannot mask it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SLUG_RE, type Observation, type ObservedStatus } from './status';

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
  if (['Failed', 'Error', 'Timeout', 'Aborted'].includes(outcome)) return 'REGRESSED';
  if (['NotExecuted', 'NotRunnable', 'Disconnected'].includes(outcome)) return 'STALE-BINDING';
  return 'NOT-RUN';
}

interface Definition {
  name: string;
  findings: string[];
}

function assertComplete(xml: string, resultCount: number): void {
  if (!/<TestRun\b/.test(xml)) throw new XunitReportError('not a TRX document (no <TestRun> element)');
  if (!/<\/TestRun>\s*$/.test(xml)) {
    throw new XunitReportError('incomplete TRX document (no closing </TestRun>); an interrupted run is not evidence');
  }
  const total = /<Counters\b[^>]*?\btotal\s*=\s*"(\d+)"/.exec(xml)?.[1];
  if (total !== undefined && Number(total) !== resultCount) {
    throw new XunitReportError(`TRX Counters total=${total} but the document holds ${resultCount} results`);
  }
}

function readTrx(
  xml: string,
  extraNameBindings: ReadonlyMap<string, readonly string[]> | undefined,
  seen: Set<string>,
): Observation[] {
  const resultTags = [...xml.matchAll(/<UnitTestResult\b([^>]*?)\/?>/g)];
  assertComplete(xml, resultTags.length);

  const definitions = new Map<string, Definition>();
  for (const m of xml.matchAll(/<UnitTest\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTest>)/g)) {
    const a = attrs(m[1] ?? '');
    if (!a.id) continue;
    const findings: string[] = [];
    const body = m[2] ?? '';
    for (const p of body.matchAll(/<Property>\s*<Key>([\s\S]*?)<\/Key>\s*<Value>([\s\S]*?)<\/Value>\s*<\/Property>/g)) {
      if (decode(p[1] ?? '').trim() !== 'Finding') continue;
      const id = decode(p[2] ?? '').trim();
      if (SLUG_RE.test(id) && !findings.includes(id)) findings.push(id);
    }
    definitions.set(a.id, { name: a.name ?? '', findings });
  }

  const out: Observation[] = [];
  for (const m of resultTags) {
    const a = attrs(m[1] ?? '');
    const def = a.testId ? definitions.get(a.testId) : undefined;
    const name = def?.name || a.testName || '';
    seen.add(name);
    const ids = [...(def?.findings ?? [])];
    for (const extra of extraNameBindings?.get(name) ?? []) if (!ids.includes(extra)) ids.push(extra);
    const status = statusFor(a.outcome ?? '');
    for (const id of ids) out.push({ id, status, source: 'xunit', test: name });
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
  if (files.length === 0) throw new XunitReportError(`no .trx files in ${dir} (nothing ran is not a pass)`);
  const seen = new Set<string>();
  const out = files.flatMap((f) => readTrx(readFileSync(join(dir, f), 'utf8'), extraNameBindings, seen));
  return [...out, ...notRunBindings(extraNameBindings, seen)];
}
