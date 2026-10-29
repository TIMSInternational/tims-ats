/**
 * The static half of the binding inventory: which finding checks one source file DECLARES, read from
 * the source text alone, independent of any evidence file. inventory.ts runs it over every committed
 * file at the evidence SHA and requires each entry to appear in the evidence.
 *
 * Binding rules mirror the collectors exactly:
 *   vitest      `[finding:<id>]` in a test's full name (ancestor describe titles + title, joined by " ")
 *   playwright  `@finding:<id>` in the title path (joined by " ", as Playwright does) or in a `{ tag }`
 *               option on the test or an enclosing describe; the evidence name is the title path below
 *               the file, joined by " › "
 *   xunit       `[finding:<id>]` in a `DisplayName = "..."` literal; the TRX name is that literal, or the
 *               literal followed by "(args)" for a theory row
 *
 * WHAT A STATIC SCAN CANNOT SEE, and how each case fails closed:
 *   - A title built at runtime (template substitution, a variable, `.each` / `.for` formatting): the test
 *     carries its tags under a name nobody can predict. Any tag in its title path becomes an
 *     UNRESOLVABLE entry (name null), which no evidence satisfies: that finding is NOT-RUN.
 *   - A tagged describe that calls an unknown function at statement level (a helper may declare tests
 *     there), or holds no statically visible test: UNRESOLVABLE entry for its ids.
 *   - A complete tag anywhere else in a scanned file (comment, constant, test body, hook title): the
 *     scanner cannot tell what it binds, so it is an UNRESOLVABLE entry.
 *   - A tag prefix followed by something that builds the id at runtime (`${`, a quote, `{`, end of
 *     file), or a non-literal Playwright `tag` option: no id can be attributed, so it is reported as
 *     unattributable, which inventory.ts turns into an untrusted run.
 *   - NOT detected: a tag assembled without the literal prefix text (e.g. from character codes), a tag
 *     that lives in a file the scan does not read (non-code files, scripts/reaudit/), tests declared by a
 *     helper called from a describe other than as a statement-level call, and omitted ROWS of a theory or
 *     of tests generated in a loop under one static name. The inventory is a lower bound on the checks,
 *     never a complete one.
 */
import { leftovers, lineAt, type FileScan, type InventorySource, type Span } from './inventory-common';
import { scanJs } from './inventory-scan-js';
import { tagIds } from './status';

export type { FileScan, InventoryEntry, InventorySource } from './inventory-common';

/** Playwright's testDir lives under e2e/ (e2e/playwright.config.ts); the root Vitest config excludes it. */
const PLAYWRIGHT_PREFIXES = ['e2e/'];
const JS_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export function sourceForPath(path: string): InventorySource | null {
  if (path.endsWith('.cs')) return 'xunit';
  if (!JS_EXT.test(path)) return null;
  return PLAYWRIGHT_PREFIXES.some((p) => path.startsWith(p)) ? 'playwright' : 'vitest';
}

// C# (xunit)

const CS_LITERAL = /DisplayName\s*=\s*"((?:[^"\\\n]|\\.)*)"/g;
const CS_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'" };

function decodeCs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) =>
    e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (CS_ESCAPES[e] ?? `\\${e}`),
  );
}

function scanCs(file: string, text: string): FileScan {
  const out: FileScan = { entries: [], unattributable: [] };
  const consumed: Span[] = [];
  for (const m of text.matchAll(CS_LITERAL)) {
    // A $ or @ prefix sits between `=` and the quote, so this pattern never matches those literals.
    const name = decodeCs(m[1] ?? '');
    const ids = tagIds(name);
    if (ids.length === 0) continue;
    consumed.push({ start: m.index, end: m.index + m[0].length });
    const line = lineAt(text, m.index);
    for (const id of ids) out.entries.push({ id, source: 'xunit', file, line, offset: m.index, name });
  }
  leftovers(file, text, 'xunit', consumed, out);
  return out;
}

/** Every binding `file` declares. `file` is repository-relative; files no collector reads yield nothing. */
export function scanFile(file: string, text: string): FileScan {
  const source = sourceForPath(file);
  if (source === null) return { entries: [], unattributable: [] };
  const out = source === 'xunit' ? scanCs(file, text) : scanJs(file, text, source);
  const lineOf = (where: string) => Number(where.slice(where.lastIndexOf(':') + 1));
  out.unattributable = [...new Set(out.unattributable)].sort((a, b) => lineOf(a) - lineOf(b));
  return out;
}
