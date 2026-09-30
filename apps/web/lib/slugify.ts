/**
 * Slug helpers shared by every form that derives an organization slug from a
 * human name. Accented letters are folded to their base letter (NFD + strip
 * combining marks) BEFORE the non-alphanumeric pass, so "Logística" becomes
 * "logistica" instead of "log-stica".
 */

const COMBINING_MARKS = /\p{M}+/gu;

export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '');
}

/** Full slug: lowercase ASCII words joined by single hyphens, no leading/trailing hyphen. */
export function slugify(text: string, maxLength = 50): string {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Keystroke-level cleanup for a slug the user is typing by hand: folds accents and
 * replaces anything else outside [a-z0-9-] with a hyphen, but keeps trailing hyphens
 * so the user can still type "mi-" on the way to "mi-empresa".
 */
export function sanitizeSlugInput(text: string): string {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
}
