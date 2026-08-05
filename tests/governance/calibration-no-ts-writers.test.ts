import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// #57 / #70 — the calibration_* TS-writer tripwire.
//
// WHY THIS EXISTS. Ownership flip #70 moves calibration_sessions / calibration_members /
// calibration_votes from `efcoreStranglerWrite` to `efcore` in docs/architecture/table-ownership.md
// and deletes their three Prisma models. Its precondition is that NOTHING in TypeScript reaches
// those tables through Prisma. #57 established that (the ninebox router was the last one and is
// deleted). This test PINS it, so the precondition cannot be silently un-met between now and the
// flip — and so that after the flip, a re-added Prisma model + writer is caught here as well as by
// the ledger check.
//
// This pins an INVARIANT (zero Prisma-delegate reach into these three models), not an era. It stays
// correct and stays useful after #70 executes: post-flip the models are gone, so any reintroduced
// delegate reference would not even compile — and this test would still fail first, with a message
// that names the flip.
//
// WHAT IT DELIBERATELY DOES NOT FORBID. scripts/parity/seed.ts writes all three tables with RAW SQL
// (`db.query('INSERT INTO calibration_sessions …')`) on a `pg` client, and scripts/parity/write-surfaces.ts
// SELECTs them for read-back assertions. That is the parity-fixture harness running against the
// parity/staging database — not a runtime application path, and not a Prisma delegate, so it
// survives model deletion and does not block #70. Raw SQL in the RUNTIME packages is a different
// matter and IS forbidden below.

const ROOT = join(__dirname, '..', '..');

/** Source roots that are compiled into, or invoked by, something that runs. */
const RUNTIME_ROOTS = ['packages/api/src', 'apps/web', 'workers', 'packages/db/prisma'];
/** Everything scanned for Prisma-delegate reach, runtime or tooling. */
const ALL_ROOTS = [...RUNTIME_ROOTS, 'packages/shared/src', 'scripts', 'tests'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', 'generated']);

/** This file itself quotes the forbidden patterns, so it must never scan itself. */
const SELF = 'tests/governance/calibration-no-ts-writers.test.ts';

function walk(rel: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, rel));
  } catch {
    return; // a root that does not exist is reported by the file-count floor below, not silently
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = `${rel}/${name}`;
    if (statSync(join(ROOT, childRel)).isDirectory()) {
      walk(childRel, out);
    } else if (/\.(ts|tsx|mts|cts)$/.test(name) && childRel !== SELF) {
      out.push(childRel);
    }
  }
}

function collect(roots: string[]): { file: string; text: string }[] {
  const files: string[] = [];
  for (const r of roots) walk(r, files);
  return files.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
}

/** `db.calibrationVote.`, `tenantDb.calibrationSession.`, `tx.calibrationMember.`, `prisma.…` */
const PRISMA_DELEGATE = /\b(?:db|tenantDb|prisma|tx|client)\.(calibrationSession|calibrationMember|calibrationVote)\b/;
/** Raw DML against the three tables, in any casing / whitespace form. */
const RAW_DML =
  /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?(calibration_sessions|calibration_members|calibration_votes)\b/i;

function hits(sources: { file: string; text: string }[], re: RegExp): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe('calibration_* have zero TypeScript writers (ownership flip #70 precondition)', () => {
  const all = collect(ALL_ROOTS);
  const runtime = collect(RUNTIME_ROOTS);

  // An empty scan would make every assertion below pass vacuously — the exact failure mode that
  // made /gate checks 14 and 17 tick against a database with no rows. Prove the walker found the
  // repo before trusting anything it reports.
  it('actually scanned the repository (guards against a vacuous pass)', () => {
    expect(all.length).toBeGreaterThan(300);
    expect(runtime.length).toBeGreaterThan(100);
    // ...and prove the patterns still match what they are supposed to match, on synthetic input.
    // Without this, a typo'd regex is indistinguishable from a clean repo.
    expect(PRISMA_DELEGATE.test('  return db.calibrationVote.upsert({')).toBe(true);
    expect(PRISMA_DELEGATE.test('await tenantDb.calibrationSession.update({ where }')).toBe(true);
    expect(PRISMA_DELEGATE.test('const m = await tx.calibrationMember.findFirst({')).toBe(true);
    expect(RAW_DML.test("await db.query('INSERT INTO calibration_votes (id) VALUES ($1)')")).toBe(true);
    expect(RAW_DML.test('UPDATE public.calibration_sessions SET status =')).toBe(true);
    // ...and that they do NOT match the things that are legitimately present (no false positives).
    expect(PRISMA_DELEGATE.test('db.nineBoxEvaluation.findMany({')).toBe(false);
    expect(RAW_DML.test('SELECT id FROM calibration_sessions WHERE organization_id = $1')).toBe(false);
  });

  it('no TypeScript file reaches the three calibration models through a Prisma delegate', () => {
    const found = hits(all, PRISMA_DELEGATE);
    expect(
      found,
      `A TypeScript Prisma delegate touches a calibration_* model. Ownership flip #70 moves these\n` +
        `three tables to EF Core and deletes their Prisma models — a delegate reference here blocks it\n` +
        `(and will not compile once the flip lands). Port the caller to the C# endpoints in\n` +
        `services/Tims.Platform/src/Tims.Api/NineBox/NineBoxWriteEndpoints.cs instead:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no RUNTIME package issues raw DML against the three calibration tables', () => {
    const found = hits(runtime, RAW_DML);
    expect(
      found,
      `A runtime source issues raw INSERT/UPDATE/DELETE against a calibration_* table. C# is the sole\n` +
        `writer of these tables (#57); a second writer breaks the one-active-writer guarantee the\n` +
        `ownership ledger records. (scripts/parity/* is deliberately exempt — fixture SQL against the\n` +
        `parity database, not a runtime path.):\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('the ledger still classifies all three tables as efcoreStranglerWrite (moving them is flip #70, not this issue)', () => {
    const doc = readFileSync(join(ROOT, 'docs/architecture/table-ownership.md'), 'utf8');
    const ledger = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)![1]) as Record<string, string[]>;
    for (const t of ['calibration_sessions', 'calibration_members', 'calibration_votes']) {
      expect(ledger['efcoreStranglerWrite'], t).toContain(t);
      expect(ledger['efcore'], t).not.toContain(t);
    }
  });
});
