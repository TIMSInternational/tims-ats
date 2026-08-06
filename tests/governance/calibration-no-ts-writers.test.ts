import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
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
// This pins an INVARIANT (zero Prisma reach into these three models), not an era. It stays correct
// and stays useful after #70 executes: post-flip the models are gone, so any reintroduced delegate
// reference would not even compile — and this test would still fail first, with a message that
// names the flip.
//
// ── SCANNING STRATEGY: DENY-LIST, NOT ALLOW-LIST ────────────────────────────────────────────────
// An earlier version of this file listed seven source roots explicitly. That is the wrong shape for
// a governance tripwire and it was demonstrably unsound: `packages/ai/src` was never scanned, yet it
// calls Prisma delegates today (registry.ts `db.aiAgent.upsert`, logger.ts `db.aiAgentUsageLog.create`)
// and is compiled into the API runtime. A calibration write added there would have left every
// assertion green while the flip's precondition was false.
//
// So: walk the WHOLE repository and prune what cannot contain first-party source. A package added
// tomorrow is scanned automatically. The failure mode of a deny-list (scanning something harmless)
// is a false positive you notice; the failure mode of an allow-list is a false negative you do not.
//
// WHAT IT DELIBERATELY DOES NOT FORBID. scripts/parity/seed.ts writes all three tables with RAW SQL
// (`db.query('INSERT INTO calibration_sessions …')`) on a `pg` client, and scripts/parity/write-surfaces.ts
// SELECTs them for read-back assertions. That is the parity-fixture harness running against the
// parity/staging database — not a runtime application path, and not a Prisma delegate, so it
// survives model deletion and does not block #70. Raw SQL in the RUNTIME packages is a different
// matter and IS forbidden below.

const ROOT = join(__dirname, '..', '..');

/**
 * Directory names pruned anywhere in the tree. `.claude` matters more than it looks: workflow
 * worktrees are checked out under `.claude/worktrees/`, so without it this test would scan several
 * complete copies of the repo (including branches mid-flip) and report their hits as this branch's.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.claude',
  '.next',
  '.turbo',
  '.vercel',
  'dist',
  'build',
  'out',
  'coverage',
  'generated',
  'bin',
  'obj',
]);

/** This file itself quotes the forbidden patterns, so it must never scan itself. */
const SELF = 'tests/governance/calibration-no-ts-writers.test.ts';

/**
 * Paths that are NOT compiled into anything that runs against a real database. Everything else the
 * walker finds is treated as runtime — derived, so a new package is runtime by default rather than
 * by remembering to list it.
 */
const NON_RUNTIME_PREFIXES = ['tests/', 'scripts/', 'tools/', 'contracts/'];

function isRuntime(file: string): boolean {
  if (NON_RUNTIME_PREFIXES.some((p) => file.startsWith(p))) return false;
  return !/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(file);
}

function walk(rel: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, rel) || ROOT);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    let st;
    try {
      st = statSync(join(ROOT, childRel));
    } catch {
      continue; // broken symlink
    }
    if (st.isDirectory()) {
      walk(childRel, out);
    } else if (/\.(ts|tsx|mts|cts)$/.test(name) && childRel !== SELF) {
      out.push(childRel);
    }
  }
}

const ALL_FILES: string[] = [];
walk('', ALL_FILES);
const SOURCES = ALL_FILES.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
const RUNTIME_SOURCES = SOURCES.filter((s) => isRuntime(s.file));

const MODELS = 'calibrationSession|calibrationMember|calibrationVote';

/**
 * Any receiver, not a fixed list of five. `prismaClient.calibrationVote` and `_db.calibrationSession`
 * both reach the model and neither matched the previous `\b(?:db|tenantDb|prisma|tx|client)\.` form.
 *
 * No method call is required after the model name, deliberately: `packages/api/src/access/scoped-probe.ts`
 * registers delegates as bare thunks (`() => tenantDb.calibrationSession`), and that IS a live Prisma
 * coupling that must be removed before the flip — it is the form a `.model.method(` grep misses, and
 * the form that was missed when this stream's blocker set was first assembled.
 *
 * SINGULAR ONLY, and that is load-bearing. A Prisma delegate is always the singular camelCase model
 * name; the plural spellings are either User back-relation fields or, more commonly here, fields on a
 * C# response DTO — `apps/web/lib/platform-api/ninebox.ts` reads `raw.calibrationSessions`, a KPI
 * count off the JSON, which has nothing to do with Prisma. A trailing `s?` matched it and made this
 * test fail against correct code. Nested relation WRITES are covered by RELATION_WRITE below, which
 * is the precise construct that actually reaches the tables.
 */
const PRISMA_DELEGATE = new RegExp(`[A-Za-z_$][\\w$]*\\s*\\.\\s*(?:${MODELS})\\b`);
/** `db['calibrationVote']` — the same reach, spelled to defeat a dotted-access grep. */
const BRACKET_DELEGATE = new RegExp(`\\[\\s*['"\`](?:${MODELS})['"\`]\\s*\\]`);

/**
 * Nested relation writes through User's four calibration back-relations. The ownership-flip runbook
 * is explicit that a `.model.method` grep cannot see these: `db.user.update({ data: { calibrationVotes:
 * { create: … } } })` is a compile-valid write to calibration_votes containing no `db.calibrationVote`
 * token. Relation names come from packages/db/prisma/schema/user.prisma:118-121.
 */
const RELATION_FIELDS = [
  'calibrationSessionsCreated',
  'calibrationMemberships',
  'calibrationEvaluated',
  'calibrationVotes',
];
const NESTED_WRITE_OPS =
  'create|createMany|connectOrCreate|update|updateMany|upsert|delete|deleteMany|set|disconnect|connect';
const RELATION_WRITE = new RegExp(`(?:${RELATION_FIELDS.join('|')})\\s*:\\s*\\{\\s*(?:${NESTED_WRITE_OPS})\\b`);

/**
 * Raw DML against the three tables. Matched against WHITESPACE-NORMALISED file text, not per line:
 * a template literal that wraps after `INSERT INTO` is invisible to a line-by-line scan, and quoted
 * identifiers (`INSERT INTO "calibration_votes"`) are the more idiomatic Prisma `$executeRaw` form.
 */
const RAW_DML = new RegExp(
  `\\b(?:insert\\s+into|update|delete\\s+from)\\s+["'\`]?(?:public\\.)?["'\`]?(calibration_sessions|calibration_members|calibration_votes)\\b`,
  'i',
);

type Source = { file: string; text: string };

/** Line-anchored scan — keeps a precise file:line for the report. */
function hits(sources: Source[], re: RegExp): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

/** Whole-file scan on collapsed whitespace — catches constructs split across lines. */
function hitsAcrossLines(sources: Source[], re: RegExp): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    const flat = text.replace(/\s+/g, ' ');
    const m = flat.match(re);
    if (m) found.push(`${file}: …${m[0]}…`);
  }
  return found;
}

describe('calibration_* have zero TypeScript writers (ownership flip #70 precondition)', () => {
  // An empty or partial scan would make every assertion below pass vacuously — the exact failure
  // mode that made /gate checks 14 and 17 tick against a database with no rows.
  //
  // The previous version guarded this with an AGGREGATE file-count floor, which cannot detect a
  // single root going blind: apps/web alone contributes ~447 files, so losing packages/api/src
  // entirely still cleared a >300 floor. These are PER-DIRECTORY existence + floor assertions, so a
  // renamed or moved package fails loudly, by name.
  describe('the scan is not vacuous', () => {
    const MUST_SCAN: [string, number][] = [
      ['packages/api/src', 100],
      ['apps/web', 100],
      ['packages/db/prisma', 3],
      ['packages/shared/src', 10],
      ['packages/ai/src', 5],
      ['tests', 100],
      ['scripts', 10],
    ];

    it.each(MUST_SCAN)('scanned %s (at least %i files)', (dir, floor) => {
      expect(
        existsSync(join(ROOT, dir)),
        `${dir} does not exist — it was renamed or moved. Update MUST_SCAN; do NOT delete the entry, or this tripwire goes blind to it.`,
      ).toBe(true);
      const n = ALL_FILES.filter((f) => f.startsWith(`${dir}/`)).length;
      expect(n, `${dir} contributed ${n} files to the scan, expected >= ${floor}`).toBeGreaterThanOrEqual(floor);
    });

    it('classifies runtime vs non-runtime without emptying either side', () => {
      expect(RUNTIME_SOURCES.length).toBeGreaterThan(300);
      expect(SOURCES.length - RUNTIME_SOURCES.length).toBeGreaterThan(100);
    });

    // Prove every pattern still matches what it is supposed to match, on synthetic input. Without
    // this, a typo'd regex is indistinguishable from a clean repo.
    it('the patterns match the constructs they claim to', () => {
      expect(PRISMA_DELEGATE.test('  return db.calibrationVote.upsert({')).toBe(true);
      expect(PRISMA_DELEGATE.test('await tenantDb.calibrationSession.update({ where }')).toBe(true);
      expect(PRISMA_DELEGATE.test('const m = await tx.calibrationMember.findFirst({')).toBe(true);
      // Receivers the old five-name alternation missed:
      expect(PRISMA_DELEGATE.test('await prismaClient.calibrationVote.create({')).toBe(true);
      expect(PRISMA_DELEGATE.test('await _db.calibrationSession.delete({')).toBe(true);
      // The BARE delegate reference — no method call. This is the scoped-probe.ts DELEGATES form,
      // and the one a `.model.method(` grep cannot see.
      expect(PRISMA_DELEGATE.test('  calibrationSession: () => tenantDb.calibrationSession,')).toBe(true);
      expect(BRACKET_DELEGATE.test("await db['calibrationVote'].create({")).toBe(true);
      // Nested relation write — no `db.calibrationVote` token anywhere in it:
      expect(RELATION_WRITE.test('data: { calibrationVotes: { create: { sessionId } } }')).toBe(true);
      expect(RELATION_WRITE.test('calibrationMemberships: { createMany: { data } }')).toBe(true);
      // Raw DML, including the quoted and line-wrapped forms:
      expect(RAW_DML.test("await db.query('INSERT INTO calibration_votes (id) VALUES ($1)')")).toBe(true);
      expect(RAW_DML.test('UPDATE public.calibration_sessions SET status =')).toBe(true);
      expect(RAW_DML.test('INSERT INTO "calibration_votes" (id) VALUES ($1)')).toBe(true);
      expect(RAW_DML.test('INSERT INTO calibration_votes (id)'.replace(/\s+/g, ' '))).toBe(true);
    });

    it('the patterns do NOT match legitimate neighbouring constructs', () => {
      expect(PRISMA_DELEGATE.test('db.nineBoxEvaluation.findMany({')).toBe(false);
      expect(RAW_DML.test('SELECT id FROM calibration_sessions WHERE organization_id = $1')).toBe(false);
      // A PLURAL field read off a C# JSON response is not a Prisma delegate. This exact line is live
      // at apps/web/lib/platform-api/ninebox.ts:336 and an earlier draft of this regex failed on it.
      expect(PRISMA_DELEGATE.test('    calibrationSessions: num(raw.calibrationSessions),')).toBe(false);
      // A read-shaped relation include is not a write:
      expect(RELATION_WRITE.test('include: { calibrationVotes: true }')).toBe(false);
      expect(RELATION_WRITE.test('select: { calibrationVotes: { select: { id: true } } }')).toBe(false);
    });
  });

  it('no TypeScript file reaches the three calibration models through a Prisma delegate', () => {
    const found = [...hits(SOURCES, PRISMA_DELEGATE), ...hits(SOURCES, BRACKET_DELEGATE)];
    expect(
      found,
      `A TypeScript Prisma delegate touches a calibration_* model. Ownership flip #70 moves these\n` +
        `three tables to EF Core and deletes their Prisma models — a delegate reference here blocks it\n` +
        `(and will not compile once the flip lands). Port the caller to the C# endpoints in\n` +
        `services/Tims.Platform/src/Tims.Api/NineBox/NineBoxWriteEndpoints.cs instead:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no TypeScript file writes the calibration tables through a User back-relation', () => {
    const found = hits(SOURCES, RELATION_WRITE);
    expect(
      found,
      `A nested Prisma relation write reaches a calibration_* table without naming its delegate.\n` +
        `\`db.user.update({ data: { calibrationVotes: { create: … } } })\` is a compile-valid write to\n` +
        `calibration_votes that a \`.model.method\` grep cannot see — the ownership-flip runbook calls\n` +
        `this out explicitly. It blocks flip #70 exactly as a direct delegate write does:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('no RUNTIME package issues raw DML against the three calibration tables', () => {
    const found = hitsAcrossLines(RUNTIME_SOURCES, RAW_DML);
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
