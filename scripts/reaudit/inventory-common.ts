/** Types and the leftover-tag scan shared by the JS/TS and C# inventory scanners (see inventory-scan.ts). */

export type InventorySource = 'vitest' | 'playwright' | 'xunit';

export interface InventoryEntry {
  id: string;
  source: InventorySource;
  /** Repository-relative path of the declaring file. */
  file: string;
  line: number;
  /** Character offset of the declaration: what tells two declarations on one line apart. */
  offset: number;
  /** The exact name the evidence must show; null = cannot be resolved statically (never satisfied). */
  name: string | null;
  why?: string;
}

export interface FileScan {
  entries: InventoryEntry[];
  /** `file:line` of tag prefixes whose id is built at runtime. */
  unattributable: string[];
}

const PREFIX_RE = /\[finding:|@finding:/g;

export function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const SLUG_AT = /^[a-z0-9]+(?:-[a-z0-9]+)*/;

/**
 * A tag at `index`. `[finding:<slug>]` is delimited by its bracket, so it is complete. A Playwright tag
 * runs to the next whitespace (/@\S+/), so `@finding:<slug>` is complete only before whitespace or the
 * end of the text; before anything else (a closing quote that `+ x` may follow, `${`) the id may be
 * extended at runtime, and `open` is set.
 */
function tagAt(text: string, index: number, prefix: string): { id: string | null; open: boolean } {
  const rest = text.slice(index + prefix.length, index + prefix.length + 80);
  const slug = SLUG_AT.exec(rest)?.[0];
  if (!slug) return { id: null, open: true };
  const next = rest[slug.length];
  if (prefix === '[finding:') return next === ']' ? { id: slug, open: false } : { id: null, open: true };
  return { id: slug, open: next !== undefined && !/\s/.test(next) };
}

export interface Span {
  start: number;
  end: number;
}

/** Tag occurrences outside every consumed span: complete ones are UNRESOLVABLE, dynamic ones unattributable. */
export function leftovers(
  file: string,
  text: string,
  source: InventorySource,
  consumed: readonly Span[],
  out: FileScan,
) {
  for (const m of text.matchAll(PREFIX_RE)) {
    const i = m.index;
    if (consumed.some((s) => i >= s.start && i < s.end)) continue;
    // A prose placeholder (`[finding:<id>]`) names no id and builds none.
    if (text[i + m[0].length] === '<') continue;
    const { id, open } = tagAt(text, i, m[0]);
    const line = lineAt(text, i);
    if (id)
      out.entries.push({
        id,
        source,
        file,
        line,
        offset: i,
        name: null,
        why: 'tag outside a statically resolvable test title',
      });
    // Any other incomplete tag may have its id (or a suffix of it) built at runtime: fail closed.
    if (open) out.unattributable.push(`${file}:${line}`);
  }
}
