/**
 * The binding inventory: every public finding check the COMMITTED source declares at the evidence SHA,
 * found by scanning the source (inventory-scan.ts), never by trusting what the evidence says ran.
 *
 * Collectors only see the checks a report contains. A filtered or partial run (`vitest run one.test.ts`,
 * `-t`, a Playwright `--grep`, one .NET project) simply leaves the other checks out, and a sibling
 * check's pass would then carry the finding. reconcileInventory closes that: every inventoried check
 * for a known finding must match an evidence entry (same source, same id, same exact name, same file
 * where the evidence names one). One that does not is NOT-RUN for its finding and, for a supplied
 * source, an untrusted-run reason, so --gate launch fails. Private (name-only) bindings are reconciled
 * by the collectors themselves (bindings.ts).
 *
 * The scan reads the git objects of the SHA (`git grep` + `git cat-file`), not the working tree, so it
 * describes exactly the commit the provenance manifests name. Excluded: scripts/reaudit/ (the harness's
 * own tests carry synthetic tags in fixtures) and every file no collector reads (see sourceForPath).
 * Any git failure throws: an inventory that cannot be read is never an empty one.
 */
import { spawnSync } from 'node:child_process';
import { scanFile, sourceForPath, type InventoryEntry, type InventorySource } from './inventory-scan';
import type { Collection, EvidenceKey, Observation } from './status';

export interface BindingInventory {
  sha: string;
  entries: InventoryEntry[];
  /** `file:line` of tag prefixes whose id is built at runtime. */
  unattributable: string[];
}

export const EXCLUDED_PREFIXES = ['scripts/reaudit/'];

function git(repoRoot: string, args: readonly string[], okStatuses: readonly number[] = [0]): string {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status === null || !okStatuses.includes(r.status)) {
    throw new Error(`git ${args.join(' ')} exited ${r.status}: ${(r.stderr ?? '').trim().split('\n')[0]}`);
  }
  return r.stdout;
}

export function readInventory(repoRoot: string, sha: string): BindingInventory {
  git(repoRoot, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  // -l: names only; -z: NUL-separated "<sha>:<path>"; -I: skip binaries. Exit 1 = no match.
  const raw = git(repoRoot, ['grep', '-l', '-z', '-I', '-E', '-e', '\\[finding:|@finding:', sha, '--'], [0, 1]);
  const prefix = `${sha}:`;
  const entries: InventoryEntry[] = [];
  const unattributable: string[] = [];
  for (const item of raw.split('\0')) {
    if (item === '') continue;
    if (!item.startsWith(prefix)) throw new Error(`unexpected git grep output: ${JSON.stringify(item)}`);
    const file = item.slice(prefix.length);
    if (EXCLUDED_PREFIXES.some((p) => file.startsWith(p)) || sourceForPath(file) === null) continue;
    const scan = scanFile(file, git(repoRoot, ['cat-file', 'blob', `${sha}:${file}`]));
    entries.push(...scan.entries);
    unattributable.push(...scan.unattributable);
  }
  return { sha, entries, unattributable };
}

/** Same file when one path ends with the other at a segment boundary (absolute / rootDir-relative). */
function sameFile(repoRelative: string, reported: string | undefined): boolean {
  if (reported === undefined || reported === '') return false;
  const a = repoRelative.replace(/\\/g, '/');
  const b = reported.replace(/\\/g, '/');
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function matches(e: InventoryEntry, key: EvidenceKey): boolean {
  if (e.name === null) return false;
  if (e.source === 'xunit') return key.name === e.name || key.name.startsWith(`${e.name}(`);
  return key.name === e.name && sameFile(e.file, key.file);
}

export function reconcileInventory(
  inv: BindingInventory,
  observations: readonly Observation[],
  supplied: ReadonlySet<InventorySource>,
  knownIds: ReadonlySet<string>,
): Collection {
  const out: Observation[] = [];
  const untrusted: string[] = [];
  for (const e of inv.entries) {
    if (!knownIds.has(e.id)) continue;
    const ran = observations.some((o) => o.source === e.source && o.id === e.id && o.key && matches(e, o.key));
    if (ran) continue;
    const what = e.name === null ? `unresolvable: ${e.why ?? 'not a static test title'}` : `"${e.name}"`;
    out.push({
      id: e.id,
      status: 'NOT-RUN',
      source: e.source,
      test: `${e.file}:${e.line} ${what} (not in the evidence)`,
    });
    if (e.name === null || supplied.has(e.source)) {
      untrusted.push(
        `inventory: ${e.file}:${e.line} declares a ${e.source} check for ${e.id} (${what}) that the evidence does not show`,
      );
    }
  }
  for (const where of inv.unattributable) {
    untrusted.push(`inventory: ${where} builds a finding tag at runtime; its binding cannot be checked`);
  }
  return { observations: out, untrusted };
}
