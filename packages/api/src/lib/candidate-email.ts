// Canonical candidate email identity (#315).
//
// A candidate's identity within an organization is its email, compared trimmed and
// lowercased. New writes store the canonical form; reads match case-insensitively so
// legacy mixed-case / whitespace-padded rows (written before canonicalization) are
// still found. The database unique constraint `@@unique([organizationId, email])` is
// case-SENSITIVE, so it cannot catch `Foo@x.com` vs `foo@x.com` on its own — the
// write paths canonicalize first, and the staff paths additionally refuse a case
// variant of an existing row (see candidate.service.ts).

/** Trim + lowercase. The single canonical form for a candidate email. */
export function canonicalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Prisma compiles `{ equals | contains, mode: 'insensitive' }` to an UNESCAPED `ILIKE`
// (measured on Prisma 6.8.2; see routers/portal.ts), so `_` / `%` in an address are
// wildcards. Escape them so the pattern is literal. Callers still post-filter on exact
// canonical equality, so correctness never depends on how Prisma compiles the query.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * From candidate rows (already ordered oldest-first by the caller), pick the one whose
 * stored email canonically equals `sessionEmail`, or null.
 *
 * Several rows can match when legacy case-variant duplicates exist in one org (they
 * are reported by scripts/ops/candidate-email-collision-report.sql; merging them is a
 * human decision). The choice is deterministic: a row whose stored email is
 * byte-identical to the session email first (preserves the pre-#315 behaviour for
 * everyone it already worked for), then a row already stored in canonical form, then
 * the oldest variant.
 */
export function pickCanonicalEmailMatch<T extends { email: string }>(
  rows: readonly T[],
  sessionEmail: string,
): T | null {
  const canonical = canonicalizeEmail(sessionEmail);
  if (canonical.length === 0) return null;
  const matches = rows.filter((r) => canonicalizeEmail(r.email) === canonical);
  return (
    matches.find((r) => r.email === sessionEmail) ?? matches.find((r) => r.email === canonical) ?? matches[0] ?? null
  );
}
