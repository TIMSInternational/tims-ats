// packages/api/src/access/aggregate.ts
//
// k-anonymity min-5 suppression for sensitive aggregates (engagement, DEI, comp).
// Matrix §21 "ANONYMIZATION: AGGREGATE access returns only statistical summaries
// (min 5 records)". A group smaller than 5 is suppressed so an individual cannot
// be re-identified. An EMPTY group (0) is not suppressed — it reveals no person.

export const MIN_AGGREGATE_SIZE = 5;

export interface SuppressedCount {
  suppressed: boolean;
  count: number | null; // null when suppressed
}

/**
 * Suppress a single group's count if it falls in 1..4 (k-anonymity floor). A
 * count of 0 passes through unsuppressed — an empty bucket reveals no individual.
 */
export function suppressBelowMin5(count: number): SuppressedCount {
  if (count > 0 && count < MIN_AGGREGATE_SIZE) return { suppressed: true, count: null };
  return { suppressed: false, count };
}

export interface AggregateGroup {
  key: string;
  count: number | null;
  suppressed: boolean;
}

/**
 * Group rows by a key function and suppress any group below MIN_AGGREGATE_SIZE.
 * Additional guard: if the TOTAL row count is below the threshold, suppress every
 * group — otherwise two groups of 2 and 2 (total 4) would each be visibly small,
 * and a single group of 6 with a known total could be differenced.
 *
 * WARNING (caller responsibility): when ANY returned group is suppressed, callers
 * MUST NOT also disclose the total row count to the client — total-N minus the
 * visible group counts arithmetically recovers a suppressed group's size. Omit the
 * total, or return a coarsened/banded total, whenever a group is suppressed.
 */
export function aggregateGroups<T>(rows: T[], keyFn: (row: T) => string): AggregateGroup[] {
  if (rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const totalSuppress = rows.length < MIN_AGGREGATE_SIZE;
  return [...counts.entries()].map(([key, count]) => {
    const s = totalSuppress ? { suppressed: true, count: null } : suppressBelowMin5(count);
    return { key, count: s.count, suppressed: s.suppressed };
  });
}
