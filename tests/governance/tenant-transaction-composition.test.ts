import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// #45 — the `tenantDb.$transaction` tripwire (prisma/prisma#17948).
//
// WHY THIS EXISTS. `tenantDb` is `db.$extends({ query: { $allOperations } })`
// (packages/db/src/tenant-client.ts:23). When RLS is enforced, that extension wraps
// EVERY operation in its own `db.$transaction([SET LOCAL ROLE, set_config, query])`
// on the closed-over BASE client. Composing that with an outer `tenantDb.$transaction`
// therefore does not produce one atomic unit — each nested op still commits
// independently. Multi-step writes that LOOK atomic are not.
//
// MEASURED, NOT ASSUMED (2026-08-06, throwaway PostgreSQL 17 cluster, RLS_ENFORCED=true,
// prod-shaped `tenant_isolation` policy copied from packages/db/baseline/prod-public-schema.sql):
//
//   construct                        after a deliberate mid-block failure
//   -------------------------------  ---------------------------------------------
//   tenantDb.$transaction(cb)        status=pending_approval, approvals=1  <- COMMITTED
//   tenantDb.$transaction([ ... ])    status=pending_approval               <- COMMITTED
//   runTenantTransaction(orgId, cb)  status=draft,            approvals=0  <- rolled back
//
// RLS scoping was intact in all three forms; atomicity was not. So this is an
// atomicity/data-integrity tripwire, not a tenant-isolation one.
//
// WHY A DEDICATED SCAN RATHER THAN THE EXISTING CHECK. tests/portal/candidate-procedure.test.ts
// already asserts `not.toMatch(/tenantDb\.\$transaction/)` for ONE service. That regex
// cannot see the form this repo actually uses everywhere else:
//
//     import { tenantDb as db } from '@tims/db';
//     return db.$transaction(async (tx) => { ... });
//
// Every one of the 18 real call sites found for #45 was written that way, and every one
// of them was invisible to a literal `tenantDb.$transaction` grep. This file resolves the
// local alias per file first, then looks for `<alias>.$transaction`.

const ROOT = join(__dirname, '..', '..');

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

/** This file quotes the forbidden construct, so it must never scan itself. */
const SELF = 'tests/governance/tenant-transaction-composition.test.ts';

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

/** Tests legitimately mock `tenantDb.$transaction` to prove it is NOT used. */
const isTest = (f: string) => f.startsWith('tests/') || /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(f);

/**
 * The local binding `tenantDb` was imported under, or null if this file does not
 * import it. Handles both `{ tenantDb }` and `{ tenantDb as db }`, including
 * multi-specifier and multi-line import statements.
 */
function tenantAlias(text: string): string | null {
  const imports = text.matchAll(/import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g);
  for (const m of imports) {
    const source = m[2];
    if (source !== '@tims/db' && !/(^|\/)tenant-client$/.test(source) && !/(^|\/)db\/src(\/index)?$/.test(source)) {
      continue;
    }
    for (const spec of m[1].split(',')) {
      const named = spec.trim().match(/^tenantDb(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (named) return named[1] ?? 'tenantDb';
    }
  }
  return null;
}

/** Strips // and /* *\/ comments so a comment ABOUT the construct is not a violation. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Violation {
  file: string;
  alias: string;
  line: number;
  snippet: string;
}

const SCANNED: { file: string; alias: string }[] = [];
const VIOLATIONS: Violation[] = [];

for (const file of ALL_FILES) {
  if (isTest(file)) continue;
  let text: string;
  try {
    text = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  const alias = tenantAlias(text);
  if (!alias) continue;
  SCANNED.push({ file, alias });

  const code = stripComments(text);
  const pattern = new RegExp(String.raw`(^|[^\w$.])${alias}\s*\.\s*\$transaction\b`);
  code.split('\n').forEach((lineText, i) => {
    if (pattern.test(lineText)) {
      VIOLATIONS.push({ file, alias, line: i + 1, snippet: lineText.trim() });
    }
  });
}

/**
 * Named artifacts. Auto-discovery alone would make DELETING a fixed file a green
 * change; these three are the sites #45 was filed against, and each must keep
 * using runTenantTransaction. If a file is legitimately removed, delete its entry
 * DELIBERATELY rather than letting the scan silently stop covering it.
 */
const PINNED = [
  'packages/api/src/routers/vacancy/approvals.ts',
  'packages/api/src/repositories/evaluation360.repository.ts',
  'packages/api/src/repositories/pipeline.repository.ts',
];

describe('tenantDb.$transaction must never be used for multi-step writes (#45, prisma#17948)', () => {
  // NON-VACUITY. Every assertion below is "we found no violations". That is exactly
  // the shape that passes when the scanner is broken and sees nothing at all, so
  // establish the scanner has real reach BEFORE trusting an empty result.
  it('scans a non-trivial number of real tenantDb consumers (non-vacuity guard)', () => {
    expect(ALL_FILES.length).toBeGreaterThan(500);
    // 50+ runtime files import tenantDb today; a collapse to near-zero means the
    // alias resolver or the walker broke, not that the codebase stopped using it.
    expect(SCANNED.length).toBeGreaterThan(30);
    // The aliased form is the dominant one and the one a naive grep misses.
    expect(SCANNED.filter((s) => s.alias !== 'tenantDb').length).toBeGreaterThan(10);
  });

  it('resolves the `tenantDb as db` alias (proves the matcher sees the form a literal grep misses)', () => {
    // Self-test of the resolver against the exact construct the codebase writes,
    // rather than against a pattern invented here.
    expect(tenantAlias("import { tenantDb as db } from '@tims/db';")).toBe('db');
    expect(tenantAlias("import { tenantDb } from '@tims/db';")).toBe('tenantDb');
    expect(tenantAlias("import { tenantDb as db, runTenantTransaction } from '@tims/db';")).toBe('db');
    expect(tenantAlias("import { db } from '@tims/db';")).toBeNull();
    // And the matcher itself flags the aliased call.
    const alias = tenantAlias("import { tenantDb as db } from '@tims/db';")!;
    expect(
      new RegExp(String.raw`(^|[^\w$.])${alias}\s*\.\s*\$transaction\b`).test(
        '  return db.$transaction(async (tx) => {',
      ),
    ).toBe(true);
  });

  it('has zero runtime call sites', () => {
    const report = VIOLATIONS.map((v) => `${v.file}:${v.line} (alias '${v.alias}') -> ${v.snippet}`).join('\n');
    expect(report).toBe('');
  });

  it.each(PINNED)('%s exists and routes its multi-step writes through runTenantTransaction', (file) => {
    expect(existsSync(join(ROOT, file))).toBe(true);
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    expect(code).toContain('runTenantTransaction');
    const alias = tenantAlias(readFileSync(join(ROOT, file), 'utf8'));
    expect(alias).not.toBeNull();
    expect(new RegExp(String.raw`(^|[^\w$.])${alias}\s*\.\s*\$transaction\b`).test(code)).toBe(false);
  });
});
