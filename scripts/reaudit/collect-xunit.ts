/**
 * Collects per-finding observations from `dotnet test --logger trx` files.
 *
 * A test binds through `[Trait("Finding", "<id>")]`, which the TRX logger writes as
 * `<Property><Key>Finding</Key><Value>id</Value></Property>` inside the UnitTest definition's
 * `<Properties>`. Results are joined to definitions by `testId`. TRX is a small, fixed, machine-
 * written dialect, so it is read with targeted patterns rather than a general XML parser.
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

export function collectXunitTrx(
  xml: string,
  extraNameBindings?: ReadonlyMap<string, readonly string[]>,
): Observation[] {
  if (!/<TestRun\b/.test(xml)) throw new XunitReportError('not a TRX document (no <TestRun> element)');

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
  for (const m of xml.matchAll(/<UnitTestResult\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1] ?? '');
    const def = a.testId ? definitions.get(a.testId) : undefined;
    const name = def?.name || a.testName || '';
    const ids = [...(def?.findings ?? [])];
    for (const extra of extraNameBindings?.get(name) ?? []) if (!ids.includes(extra)) ids.push(extra);
    const status = statusFor(a.outcome ?? '');
    for (const id of ids) out.push({ id, status, source: 'xunit', test: name });
  }
  return out;
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
  return files.flatMap((f) => collectXunitTrx(readFileSync(join(dir, f), 'utf8'), extraNameBindings));
}
