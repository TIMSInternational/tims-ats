/**
 * Status vocabulary shared by every collector and the report.
 *
 *   FIXED-VERIFIED  a bound check ran and the ideal held
 *   OPEN-CONFIRMED  a bound check ran and confirmed the finding is still open
 *   REGRESSED       a bound check that should hold failed
 *   NOT-RUN         a bound check exists but did not run (or could not be trusted)
 *   STALE-BINDING   a bound check is skipped / fixme / todo
 *   UNBOUND         nothing checks this id
 */

export type ObservedStatus = 'FIXED-VERIFIED' | 'OPEN-CONFIRMED' | 'REGRESSED' | 'NOT-RUN' | 'STALE-BINDING';
export type ReauditStatus = ObservedStatus | 'UNBOUND';
export type ObservationSource = 'playwright' | 'vitest' | 'xunit' | 'owner';

export interface Observation {
  id: string;
  status: ObservedStatus;
  source: ObservationSource;
  /** Human-readable name of the test or check that produced this observation. */
  test: string;
  /**
   * The check as the evidence names it, for reconciling against the source inventory (inventory.ts).
   * Set ONLY on observations backed by an entry in the evidence, never on a synthesised NOT-RUN.
   */
  key?: EvidenceKey;
}

export interface EvidenceKey {
  /** The file as the evidence reports it (absolute for Vitest, rootDir-relative for Playwright); none for TRX. */
  file?: string;
  /** Vitest full name · Playwright title path below the file (" › ") · TRX test name. */
  name: string;
}

/** A collector's output: observations, plus why the run cannot be trusted as proof of any pass. */
export interface Collection {
  observations: Observation[];
  /** Non-empty: the report turns every FIXED-VERIFIED (every source) into NOT-RUN and the gate fails. */
  untrusted: string[];
}

export const REAUDIT_STATUSES: readonly ReauditStatus[] = [
  'FIXED-VERIFIED',
  'OPEN-CONFIRMED',
  'REGRESSED',
  'NOT-RUN',
  'STALE-BINDING',
  'UNBOUND',
];

/** Lower index wins. FIXED-VERIFIED is last: it survives only when EVERY binding is fixed. */
const PRECEDENCE: readonly ObservedStatus[] = [
  'REGRESSED',
  'OPEN-CONFIRMED',
  'NOT-RUN',
  'STALE-BINDING',
  'FIXED-VERIFIED',
];

/** Lowercase slug: what every finding id, persona and binding id must look like. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TAG_RE = /\[finding:([^\]]*)\]/g;

/** Ids named by `[finding:<slug>]` tags in a test name (vitest titles, xUnit DisplayNames). */
export function tagIds(name: string): string[] {
  const ids: string[] = [];
  for (const m of name.matchAll(TAG_RE)) {
    const id = m[1] ?? '';
    if (SLUG_RE.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function mergeStatuses(statuses: readonly ObservedStatus[]): ReauditStatus {
  if (statuses.length === 0) return 'UNBOUND';
  let best = PRECEDENCE.length - 1;
  for (const s of statuses) best = Math.min(best, PRECEDENCE.indexOf(s));
  return PRECEDENCE[best] as ObservedStatus;
}

export function statusById(observations: readonly Observation[]): Map<string, ReauditStatus> {
  const grouped = new Map<string, ObservedStatus[]>();
  for (const o of observations) {
    const list = grouped.get(o.id) ?? [];
    list.push(o.status);
    grouped.set(o.id, list);
  }
  const out = new Map<string, ReauditStatus>();
  for (const [id, list] of grouped) out.set(id, mergeStatuses(list));
  return out;
}
