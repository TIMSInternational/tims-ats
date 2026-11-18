const CAREERS_PATH_RE = /^\/careers(?:\/([^/]+)(\/.*)?)?\/?$/;

function lowerSlug(raw: string): string | null {
  try {
    const slug = decodeURIComponent(raw).trim().toLowerCase();
    return slug.length > 0 && slug.length <= 200 ? slug : null;
  } catch {
    return null;
  }
}

/**
 * Where the root 404 should send a visitor whose URL is under /careers: their organization's job
 * board when the missing page is BELOW a board (/careers/<slug>/<something unmatched>), no link at
 * all when the board itself is the missing page. Null outside /careers. A candidate is never sent to
 * the staff dashboard — that is the wrong door and ends on the staff login.
 */
export function careersNotFoundTarget(pathname: string | null | undefined): { href: string | null } | null {
  const match = pathname ? CAREERS_PATH_RE.exec(pathname) : null;
  if (!match) return null;
  const [, slug, rest] = match;
  if (!slug || !rest || rest === '/') return { href: null };
  const lower = lowerSlug(slug);
  return { href: lower ? `/careers/${encodeURIComponent(lower)}` : null };
}

/** The candidate portal under a board: its dashboard, which sends a signed-out candidate to the portal login. */
export function candidatePortalHref(boardHref: string): string {
  return `${boardHref}/dashboard`;
}

/**
 * The extra candidate-facing 404 actions (a link to the candidate portal under a board, "go back" where no board
 * exists). Only the exact string 'true' turns them on; otherwise the 404 pages are unchanged. Must stay a literal
 * reference so Next inlines it into the client bundle.
 */
export function isCandidate404LinksEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_CANDIDATE_404_LINKS_ENABLED,
): boolean {
  return raw === 'true';
}
