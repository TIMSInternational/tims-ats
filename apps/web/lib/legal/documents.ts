/**
 * Platform legal documents (terms, privacy, subprocessors, AI processing).
 *
 * Client-safe: no filesystem access here (that lives in `content.ts`, server-only), so the
 * footer and the apply consent step can import the slugs, hrefs and the feature flag.
 *
 * The text itself is NOT in code: it is read from `apps/web/content/legal/{es,en}/<slug>.md`
 * so counsel can replace it without a code change. Until counsel's text lands those files are
 * clearly marked drafts, which is why everything here is gated behind
 * NEXT_PUBLIC_LEGAL_PAGES_ENABLED (exact 'true' only; unset/anything else => pages 404 and no
 * link is rendered anywhere).
 */

export const LEGAL_DOCUMENT_SLUGS = ['terms', 'privacy', 'subprocessors', 'ai-processing'] as const;
export type LegalDocumentSlug = (typeof LEGAL_DOCUMENT_SLUGS)[number];

export const LEGAL_LOCALES = ['es', 'en'] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];

export function isLegalDocumentSlug(value: string): value is LegalDocumentSlug {
  return (LEGAL_DOCUMENT_SLUGS as readonly string[]).includes(value);
}

export function legalDocumentHref(slug: LegalDocumentSlug): string {
  return `/legal/${slug}`;
}

/**
 * Read at call time (not module load) so tests can stub it. In the Next.js build the
 * `process.env.NEXT_PUBLIC_*` reference is inlined, so flipping the flag needs a redeploy.
 */
export function isLegalPagesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LEGAL_PAGES_ENABLED === 'true';
}

/** Marker every draft content file carries; the page shows a DRAFT banner while it is present. */
export const LEGAL_DRAFT_MARKER = 'TODO (counsel)';

/**
 * Hard cap on a legal content file, in characters: legal text is long, but this is far above any real
 * document. The loader REFUSES a longer file (never truncates it) and the renderer is given this same limit,
 * so a silently shortened document can never publish incomplete terms (tier-1 review: the renderer used to
 * stop at 20,000). Lives here, not in the server-only loader, because the client view needs it too.
 */
export const LEGAL_MAX_CONTENT_CHARS = 200_000;
