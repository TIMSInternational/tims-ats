// Data-driven reader sweep for the ownership-flip pre-flip scan — issue #132.
//
// WHY THIS EXISTS
// ---------------
// All six of the runbook's P2 reader-sweep greps are `.ts`-scoped, and `tsc` cannot see a model name
// that lives inside a JSON file. Flip #2 (#69) removed `'successor'` / `'criticalRole'` from
// `ScopedEntity`, got a GREEN `tsc`, and only found out via 6 opaque failures in
// `contracts/access-fixtures/scope-where.json` — a file that is not an ordinary fixture but a
// CROSS-STACK contract, asserted by `tests/access/scope-where-fixtures.test.ts` AND by
// `Tims.UnitTests/Fixtures/ScopeWhereForFixtureTests.cs`. Deleting the failing cases (the tempting fix)
// would have silently removed the oracle pinning the C# implementation.
//
// Pure, dependency-free (Node stdlib only) and separated from `pre-flip-scan.ts` on purpose: the
// database arms of that script cannot run under `npx vitest run`, but THIS arm can, so it is unit-tested
// for real against the real repository rather than pinned by a source-text grep. Same split, and the same
// reason, as `scripts/table-ownership.mjs`.
//
// NON-VACUITY IS THE WHOLE POINT. `scanDataFiles` reports the population it searched — roots, file count,
// and every root it could NOT find. A caller that ignores `missingRoots` is back to a scan that examined
// nothing and reported clean, which is the defect class this repo keeps re-finding (#38, checks 14/16/17).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The data roots that are searched, PINNED BY NAME rather than discovered.
 *
 * Auto-discovery (e.g. "every *.json under the repo") would make deleting a fixture directory a green
 * change, and would drag in `node_modules`, lockfiles and the 2 MB schema baseline — which names every
 * table in the database and would therefore match every scan, i.e. pure noise that gets the check
 * switched off. Naming the roots makes REMOVING one a diff someone has to justify.
 *
 * `kind` is the classification of a hit, not of the root:
 *   blocker — the hit must be dispositioned before the Prisma model is deleted
 *   info    — the hit is expected for some tables (a `CREATE TABLE` in the DDL that defines them) and is
 *             reported for the PR body rather than failing the scan
 */
export const DATA_ROOTS = Object.freeze([
  Object.freeze({
    path: 'contracts',
    exts: Object.freeze(['.json', '.yaml', '.yml', '.csv']),
    why: 'cross-stack contract fixtures — asserted by BOTH the TS suite and Tims.UnitTests',
  }),
  Object.freeze({
    path: 'packages/db/prisma',
    exts: Object.freeze(['.ts', '.json', '.sql']),
    why: 'seeds (§8 Q9 post-flip seed hazard) and hand-applied SQL',
  }),
  Object.freeze({
    path: 'scripts/parity',
    exts: Object.freeze(['.ts', '.json']),
    why: 'the parity harness writes/reads through RAW SQL, so it survives model deletion mechanically',
  }),
  Object.freeze({
    path: 'services/Tims.Platform/db',
    exts: Object.freeze(['.sql', '.json']),
    why: 'flip-DDL and hand-applied EF scripts',
  }),
]);

/**
 * Path prefixes whose hits are BLOCKERS. Everything else found in a root above is INFO.
 *
 *  - `contracts/access-fixtures/` is the proven case: it pins the C# port of `scopeWhereFor`, so an
 *    entity named there must SURVIVE the flip. The right response to a hit is NOT to delete the case.
 *  - a `seed*` file under `packages/db/prisma/` is the §8 Q9 hazard: a seed that still writes a deleted
 *    model breaks `prisma db seed`, and a seed that writes it through raw SQL is invisible to `tsc`.
 */
const BLOCKER_MATCHERS = Object.freeze([
  Object.freeze({
    test: (rel) => rel.startsWith('contracts/access-fixtures/'),
    why:
      'CROSS-STACK CONTRACT. This file is asserted by tests/access/scope-where-fixtures.test.ts AND by ' +
      "Tims.UnitTests' ScopeWhereForFixtureTests, so the entity must SURVIVE the flip — scopeWhereFor is " +
      'a PURE function and never touches Prisma. Do NOT delete the case to make it pass: that removes the ' +
      "oracle pinning C#'s own implementation (runbook §1 step 6).",
  }),
  Object.freeze({
    test: (rel) => /^packages\/db\/prisma\/[^/]*seed[^/]*\.ts$/.test(rel),
    why:
      'SEED (§8 Q9). A seed still writing this model breaks `prisma db seed` after the model is deleted, ' +
      'and one that writes it through raw SQL is invisible to `tsc` — port or remove it in the flip PR.',
  }),
]);

/** Directory names never descended into, at any depth. */
const SKIP_DIRS = Object.freeze(new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']));

/** Capitalise the first letter only; the rest of a snake segment is already lower-case. */
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/**
 * English-plural → singular for the LAST segment of a table name. Deliberately small: the inputs are
 * this repo's table names, not arbitrary English.
 */
function singularize(word) {
  if (/ies$/i.test(word) && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/ss$/i.test(word)) return word;
  if (/s$/i.test(word) && word.length > 1) return word.slice(0, -1);
  return word;
}

/**
 * Every spelling a data file might use for a table.
 *
 * A JSON fixture names the MODEL, not the table: flip #2's break was the string `"criticalRole"` in a
 * file whose table is `critical_roles`. Searching only the snake-case table name would have found
 * nothing — which is precisely how the whole P2 sweep missed it.
 *
 * Returned lower-cased and de-duplicated; matching is case-insensitive.
 */
export function nameVariants(table) {
  const parts = String(table)
    .split('_')
    .filter((p) => p.length > 0);
  if (parts.length === 0) return [];
  const singularParts = [...parts.slice(0, -1), singularize(parts[parts.length - 1])];

  const snakePlural = parts.join('_');
  const snakeSingular = singularParts.join('_');
  const pascalPlural = parts.map(cap).join('');
  const pascalSingular = singularParts.map(cap).join('');
  const camelPlural = parts[0] + parts.slice(1).map(cap).join('');
  const camelSingular = singularParts[0] + singularParts.slice(1).map(cap).join('');

  return [
    ...new Set(
      [snakePlural, snakeSingular, pascalPlural, pascalSingular, camelPlural, camelSingular].map((v) =>
        v.toLowerCase(),
      ),
    ),
  ].sort();
}

/**
 * Word-boundary matching, so `calibration_sessions_pkey` (an index name) is not reported as a reference
 * to `calibration_sessions`. Without a boundary the migration files alone would contribute a hit per
 * index per table, and a report nobody reads enforces nothing.
 *
 * The character classes are written out rather than using `\b`. In JavaScript the two are equivalent —
 * `\w` is `[A-Za-z0-9_]`, so `\b` already treats the underscore as a word character; this was checked by
 * mutation rather than assumed, and the `\b` version passed every test here. They are spelled out
 * because the SQL side of this scan CANNOT use `\b`: in a Postgres advanced regular expression `\b` is a
 * BACKSPACE, so `'critical_roles_pkey' ~* '\bcritical_roles\b'` and `'x critical_roles y' ~* '…'` both
 * return false — a `\b` matcher there finds nothing at all and reports every scan clean. Keeping both
 * sides visibly boundary-explicit is what stops one being "simplified" into the other.
 */
function variantRegex(variant) {
  const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i');
}

/** Recursively list files under `dir` whose extension is in `exts`. Returns repo-relative POSIX paths. */
function listFiles(root, dir, exts, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable subdirectory — the caller's missingRoots covers a missing ROOT
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listFiles(root, full, exts, out);
    } else if (entry.isFile() && exts.some((e) => entry.name.toLowerCase().endsWith(e))) {
      out.push(relative(root, full).split(sep).join('/'));
    }
  }
  return out;
}

function classify(rel) {
  for (const m of BLOCKER_MATCHERS) if (m.test(rel)) return { kind: 'blocker', why: m.why };
  return { kind: 'info', why: '' };
}

/**
 * Scan the pinned data roots for any spelling of any of `tables`.
 *
 * @param {string[]} tables      table names being flipped
 * @param {string}   repoRoot    directory the roots are resolved against (cwd for the CLI, a sandbox in tests)
 * @returns {{
 *   hits: { file: string, line: number, variant: string, table: string, kind: 'blocker'|'info', why: string, text: string }[],
 *   filesScanned: number,
 *   perRoot: { path: string, files: number, present: boolean }[],
 *   missingRoots: string[],
 *   variants: Record<string, string[]>,
 * }}
 *
 * `missingRoots` is the non-vacuity control and the caller MUST fail on it: a renamed or deleted root
 * silently shrinks the searched population to zero while the result still reads "no hits".
 */
export function scanDataFiles(tables, repoRoot) {
  const perRoot = [];
  const missingRoots = [];
  const files = [];

  for (const root of DATA_ROOTS) {
    const abs = join(repoRoot, root.path);
    let present = false;
    try {
      present = statSync(abs).isDirectory();
    } catch {
      present = false;
    }
    if (!present) {
      missingRoots.push(root.path);
      perRoot.push({ path: root.path, files: 0, present: false });
      continue;
    }
    const found = listFiles(repoRoot, abs, [...root.exts], []);
    files.push(...found);
    perRoot.push({ path: root.path, files: found.length, present: true });
  }

  const variants = {};
  for (const table of tables) variants[table] = nameVariants(table);

  const hits = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    // Cheap pre-filter: skip the line-by-line walk unless some variant appears at all.
    const lower = content.toLowerCase();
    const candidates = tables.filter((t) => variants[t].some((v) => lower.includes(v)));
    if (candidates.length === 0) continue;

    const lines = content.split('\n');
    const { kind, why } = classify(file);
    for (const table of candidates) {
      for (const variant of variants[table]) {
        const re = variantRegex(variant);
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i])) continue;
          hits.push({
            file,
            line: i + 1,
            variant,
            table,
            kind,
            why,
            text: lines[i].trim().slice(0, 160),
          });
          break; // one hit per file per variant is enough to demand a look
        }
      }
    }
  }

  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.variant.localeCompare(b.variant));
  return { hits, filesScanned: files.length, perRoot, missingRoots, variants };
}
