// ---------------------------------------------------------------------------
// Prisma id-cursor pagination — the shared helper for `take: limit + 1` list endpoints (#318, #246).
// `user.list` still implements the same contract inline (fixed separately in #307).
//
// Prisma's cursor is INCLUSIVE: `cursor: { id }` positions the page AT that row, and `skip: 1` steps past
// it. So the cursor handed to the client MUST be the LAST row the client was shown. The defect this
// replaces popped the look-ahead row (row limit+1) and returned ITS id — the next page then started after
// it, and that row was shown on neither page: one row lost at every page boundary.
//
// Prisma cursors are also positional over the `orderBy`, which therefore MUST be a total order. A single
// timestamp is not one — two rows sharing a `createdAt` can repeat or vanish across pages — so every
// caller appends `id` as the final tie-break. Use the same direction as the primary key so the order is a
// simple lexicographic (key, id) tuple.
// ---------------------------------------------------------------------------

export interface CursorPageArgs {
  take: number;
  cursor?: { id: string };
  skip?: number;
}

/** `findMany` args: one look-ahead row, and — when paging — start AT the cursor row and skip it. */
export function cursorPageArgs(limit: number, cursor: string | undefined): CursorPageArgs {
  return cursor ? { take: limit + 1, cursor: { id: cursor }, skip: 1 } : { take: limit + 1 };
}

/**
 * Split a `limit + 1` fetch into the page and its `nextCursor`. The look-ahead row only signals that another
 * page exists; it is dropped here and is the FIRST row of the next page. `nextCursor` is the last row
 * RETURNED, which `skip: 1` steps past on the next call. Always returns the `nextCursor` key (undefined on the
 * last page) so response shapes are unchanged.
 */
export function takeCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | undefined } {
  if (rows.length <= limit) return { items: rows, nextCursor: undefined };
  const items = rows.slice(0, limit);
  return { items, nextCursor: items[items.length - 1]?.id };
}

/**
 * True when no cursor was sent, or when the cursor row still matches the page's OWN `where` (tenant scope +
 * filters). `findAnchor` must query the same client and the same `where` as the list query, as
 * `findFirst({ where: { AND: [where, { id }] }, select: { id: true } })`.
 *
 * Why: over a compound `orderBy`, Prisma positions on a cursor row even when the filters exclude it (archived,
 * status changed, filters changed between pages), and `skip: 1` then silently drops a REAL row. A stale cursor
 * therefore yields an empty page instead — the C# TenantAuditRepository anchor semantics. One indexed lookup
 * per paged request is the price of never skipping a row.
 */
export async function cursorRowMatches(
  cursor: string | undefined,
  findAnchor: (id: string) => Promise<{ id: string } | null>,
): Promise<boolean> {
  if (!cursor) return true;
  return (await findAnchor(cursor)) !== null;
}
