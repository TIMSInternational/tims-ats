/**
 * Collects per-finding observations from `vitest run --reporter=json` output.
 *
 * A test binds when its FULL name (every ancestor describe title + the leaf title) contains
 * `[finding:<slug>]`. Private bindings may additionally bind an untagged test by its exact full name.
 */
import { z } from 'zod';
import { SLUG_RE, type Observation, type ObservedStatus } from './status';

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
  testResults: z.array(z.object({ assertionResults: z.array(assertionSchema) })),
});

const TAG_RE = /\[finding:([^\]]*)\]/g;
const STALE = new Set(['skipped', 'todo', 'pending', 'disabled']);

function statusFor(status: string): ObservedStatus {
  if (status === 'passed') return 'FIXED-VERIFIED';
  if (status === 'failed') return 'REGRESSED';
  if (STALE.has(status)) return 'STALE-BINDING';
  return 'NOT-RUN';
}

export function tagIds(name: string): string[] {
  const ids: string[] = [];
  for (const m of name.matchAll(TAG_RE)) {
    const id = m[1] ?? '';
    if (SLUG_RE.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function collectVitest(raw: unknown, extraNameBindings?: ReadonlyMap<string, readonly string[]>): Observation[] {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success)
    throw new VitestReportError('not a vitest JSON report (expected testResults[].assertionResults[])');
  const out: Observation[] = [];
  for (const file of parsed.data.testResults) {
    for (const a of file.assertionResults) {
      const fullName = [...a.ancestorTitles, a.title].join(' ');
      const ids = tagIds(fullName);
      for (const extra of extraNameBindings?.get(fullName) ?? []) if (!ids.includes(extra)) ids.push(extra);
      const status = statusFor(a.status);
      for (const id of ids) out.push({ id, status, source: 'vitest', test: fullName });
    }
  }
  return out;
}
