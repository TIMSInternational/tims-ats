/**
 * Pure time-series helper — no DB, no side effects.
 * Used by platform dashboard procedures to collapse N+1 month-loops into
 * a single SQL group-by result mapped through this function.
 */

/**
 * Build an N-month bucket series (oldest-first) ending at `endNow`'s calendar month.
 *
 * @param rows   Raw aggregate rows from SQL: { month: 'YYYY-MM', count: number }[]
 * @param months Number of buckets to return (e.g. 6 or 12)
 * @param endNow The reference date whose calendar month is the LAST bucket
 * @returns      Exactly `months` entries, oldest-first, gaps filled with count: 0
 */
export function buildMonthSeries(
  rows: { month: string; count: number }[],
  months: number,
  endNow: Date,
): { month: string; count: number }[] {
  if (months <= 0) return [];

  // Build a lookup map from YYYY-MM → count
  const lookup = new Map<string, number>(rows.map((r) => [r.month, r.count]));

  const result: { month: string; count: number }[] = [];

  // endNow's year/month is index (months - 1); walk backwards from there
  const endYear = endNow.getUTCFullYear();
  const endMonth = endNow.getUTCMonth(); // 0-based

  for (let i = months - 1; i >= 0; i--) {
    // Subtract i months from endNow's month
    let year = endYear;
    let month = endMonth - i; // may be negative

    // Normalise: roll back years if month underflows
    while (month < 0) {
      month += 12;
      year -= 1;
    }

    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    result.push({ month: key, count: lookup.get(key) ?? 0 });
  }

  return result;
}
