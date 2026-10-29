/** Types and the leftover-tag scan shared by the JS/TS and C# inventory scanners (see inventory-scan.ts). */

export type InventorySource = 'vitest' | 'playwright' | 'xunit';

export interface InventoryEntry {
  id: string;
  source: InventorySource;
  /** Repository-relative path of the declaring file. */
  file: string;
  line: number;
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
/** A character after the prefix that starts a runtime-built id. */
const DYNAMIC_NEXT = new Set(['$', '{', "'", '"', '`']);

export function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The id of a complete tag at `index` (bracket or Playwright form), or null. */
function completeTagAt(text: string, index: number): string | null {
  const bracket = /^\[finding:([a-z0-9]+(?:-[a-z0-9]+)*)\]/.exec(text.slice(index, index + 80));
  if (bracket) return bracket[1] as string;
  const at = /^@finding:([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/.exec(text.slice(index, index + 80));
  return at ? (at[1] as string) : null;
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
    const id = completeTagAt(text, i);
    const line = lineAt(text, i);
    if (id) {
      out.entries.push({ id, source, file, line, name: null, why: 'tag outside a statically resolvable test title' });
      continue;
    }
    const next = text[i + m[0].length];
    if (next === undefined || DYNAMIC_NEXT.has(next)) out.unattributable.push(`${file}:${line}`);
  }
}
