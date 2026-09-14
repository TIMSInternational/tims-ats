import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CLASSIFICATION, auditRequiredFor } from '../../packages/api/src/access';

// ── §21 +AUDIT: every ROW-LEVEL read of a confidential-or-above entity must write
//    a data_access_logs row ──────────────────────────────────────────────────────
//
// This is the CLASS-level control. The DSAR right-of-access export went months
// writing no `data_access_logs` row at all, and the reason it went unnoticed is that
// NOTHING enumerated which readers owe one:
//
//   - `auditRequiredFor()` — the canonical "does this entity need a row" predicate —
//     is called by no production code at all, only by tests.
//   - `tests/access/scope-wiring-sensitive-data.test.ts` has per-file tripwires for
//     assessment.ts and compensation.ts, and had none for data-requests.ts.
//
// So the instance got fixed and the class stayed open. This closes the class.
//
// The entity list is DERIVED from `CLASSIFICATION` via the real `auditRequiredFor`,
// never hardcoded: registering a new confidential-or-above entity automatically
// extends this control, and de-registering one is caught by the pin at the bottom.

const API_SRC = join(__dirname, '../../packages/api/src');

/** Reads that return ROW DATA. Each such row is a §21 auditable disclosure. */
const ROW_LEVEL = ['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow'] as const;

/**
 * Reads that return only a SCALAR or a grouped tally. Deliberately a separate bucket
 * rather than an allowlist of files, because the distinction is structural, not
 * per-site: `DataAccessEvent` requires a `recordId` (`packages/api/src/access/audit.ts`),
 * and an aggregate has no record to name — the mechanism cannot express it. The
 * applicable control for these is k-anonymity / sub-floor suppression
 * (`suppressBelowMin5`), not per-record audit.
 */
const AGGREGATE = ['count', 'groupBy', 'aggregate'] as const;

const AUDIT_WRITE = /logDataAccess\(|dataAccessLog\./;

/**
 * Comment-stripped source. Same shape as `tests/db/pre-flip-scan.test.ts`'s `CODE`.
 *
 * NOT optional, and this was caught by mutation rather than reasoning: the first version
 * of this control tested `AUDIT_WRITE` against raw source, and `data-requests.ts` passed
 * on the strength of the COMMENT that says `logDataAccess()` is deliberately NOT used
 * there. Reverting that file to its pre-#155 unaudited state left the suite green — the
 * control certified a file as audited because its prose named the helper it does not
 * call. Same defect the calibration tripwire had, one layer up.
 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Scans the WHOLE source, never line by line.
 *
 * This is the lesson the calibration tripwire learned the hard way: a line-anchored
 * scan misses the spelling the formatter actually produces. The real shape in this
 * repo keeps the model on the first line and wraps the METHOD — e.g.
 * `tenantDb.userBusinessUnit\n  .findMany({…})` at access/anchors.ts:40-41. (The
 * other conceivable wrap, receiver-newline-dot-model, has zero occurrences in this
 * repo, so it is deliberately not invented here.)
 *
 * The mechanism that crosses lines is the `\s*` in the pattern — `\s` matches `\n` —
 * applied to the unsplit string. An earlier version ALSO collapsed whitespace first and
 * the docblock credited the collapse; mutating the collapse away changed nothing, which
 * is how the real mechanism was identified. The redundant step is gone so there is one
 * mechanism, and the fixture test below mutation-proves it by deleting `\s*`.
 */
export function readsIn(src: string, entities: readonly string[]): Array<{ entity: string; method: string }> {
  const methods = [...ROW_LEVEL, ...AGGREGATE].join('|');
  const found: Array<{ entity: string; method: string }> = [];
  for (const e of entities) {
    const re = new RegExp(`\\.\\s*${e}\\s*\\.\\s*(${methods})\\b`, 'g');
    for (const m of src.matchAll(re)) found.push({ entity: e, method: m[1] });
  }
  return found;
}

const AUDITED_ENTITIES = Object.keys(CLASSIFICATION).filter((e) => auditRequiredFor(e));

interface Reader {
  file: string;
  rowLevel: Array<{ entity: string; method: string }>;
  aggregate: Array<{ entity: string; method: string }>;
  audits: boolean;
}

const readers: Reader[] = tsFilesUnder(API_SRC)
  .map((abs) => {
    // Comment-stripped for BOTH halves: a commented-out delegate read must not count as
    // a reader, and prose naming logDataAccess must not count as an audit.
    const src = codeOnly(readFileSync(abs, 'utf8'));
    const reads = readsIn(src, AUDITED_ENTITIES);
    return {
      file: relative(join(__dirname, '../..'), abs),
      rowLevel: reads.filter((r) => (ROW_LEVEL as readonly string[]).includes(r.method)),
      aggregate: reads.filter((r) => (AGGREGATE as readonly string[]).includes(r.method)),
      audits: AUDIT_WRITE.test(src),
    };
  })
  .filter((r) => r.rowLevel.length > 0 || r.aggregate.length > 0);

/**
 * Files that read an audit-required entity but ONLY in aggregate. Pinned by name so a
 * file gaining its first row-level read cannot slip in silently — it would move buckets
 * and fail the primary assertion, and this list would go stale-red at the same time.
 * Adding an entry is a deliberate edit with a reviewer attached, which is the point.
 */
const AGGREGATE_ONLY = [
  'packages/api/src/repositories/alert-evaluation.repository.ts', // salaryAdjustment.count — alert metrics
  'packages/api/src/repositories/candidate-assessment.repository.ts', // assessmentResult.count ×3 — percentile norming
  'packages/api/src/repositories/dei.repository.ts', // employeeDemographics.groupBy — min-5 suppressed
  'packages/api/src/routers/monitoring.ts', // salaryAdjustment.count, surveyResponse.count — suppressBelowMin5
].sort();

describe('§21 — every row-level read of a confidential+ entity is audited', () => {
  it('derives its entity list from the real CLASSIFICATION registry, and that registry is non-empty', () => {
    // Non-vacuity first: if `auditRequiredFor` ever returned false for everything, every
    // assertion below would pass while checking nothing.
    expect(AUDITED_ENTITIES.length).toBeGreaterThanOrEqual(5);
    expect(AUDITED_ENTITIES).toEqual(
      expect.arrayContaining([
        'employeeCompensation',
        'salaryAdjustment',
        'assessmentResult',
        'employeeDemographics',
        'surveyResponse',
      ]),
    );
  });

  it('found a non-trivial population of readers — a clean result over zero files proves nothing', () => {
    expect(readers.length).toBeGreaterThanOrEqual(6);
    expect(readers.some((r) => r.rowLevel.length > 0)).toBe(true);
  });

  it('every file with a ROW-LEVEL read writes a data_access_logs row', () => {
    const unaudited = readers
      .filter((r) => r.rowLevel.length > 0 && !r.audits)
      .map((r) => `${r.file} reads ${[...new Set(r.rowLevel.map((x) => `${x.entity}.${x.method}`))].join(', ')}`);
    expect(
      unaudited,
      'These files return ROW DATA for a confidential-or-above entity without writing a data_access_logs ' +
        'row. Either audit the read (logDataAccess for tenant-scoped paths; see data-requests.ts for why a ' +
        'cross-org surface must use the privileged client instead), or narrow the read to an aggregate and ' +
        'add it to AGGREGATE_ONLY with a reason.',
    ).toEqual([]);
  });

  it('the aggregate-only readers are exactly the pinned set', () => {
    const actual = readers
      .filter((r) => r.rowLevel.length === 0 && r.aggregate.length > 0)
      .map((r) => r.file)
      .sort();
    expect(actual).toEqual(AGGREGATE_ONLY);
  });

  it('the scan sees a Prettier-WRAPPED chain, not just a single-line one', () => {
    // Drives the real scanner, not the regex — the distinction that made the calibration
    // tripwire blind. Fixture shape copied from access/anchors.ts:40-41, the way this repo
    // actually formats a wrapped delegate read.
    const wrapped = `
      const rows = await tenantDb.employeeCompensation
        .findMany({ where: { organizationId }, select: { currentSalary: true } })
        .then((r) => r);
    `;
    expect(readsIn(wrapped, AUDITED_ENTITIES)).toEqual([{ entity: 'employeeCompensation', method: 'findMany' }]);
  });

  it('classifies aggregate and row-level reads into the right buckets', () => {
    const src = 'await db.salaryAdjustment.count({}); await db.employeeDemographics.findMany({});';
    const reads = readsIn(src, AUDITED_ENTITIES);
    expect(reads).toContainEqual({ entity: 'salaryAdjustment', method: 'count' });
    expect(reads).toContainEqual({ entity: 'employeeDemographics', method: 'findMany' });
  });
});
