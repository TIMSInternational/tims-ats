// The interview room is served with a relaxed CSP (Daily call object, see
// apps/web/lib/security/csp.ts). CSP belongs to the DOCUMENT, so any soft
// (client-side) navigation out of the room would carry that relaxed policy
// onto the rest of the app. Every exit must therefore be a full document load.

export const ROOM_EXIT_PATH = '/recruitment/interviews';

/** Leave the room with a full document navigation (never a client-side router transition). */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}

/** Reload the current URL as a full document (used after a back/forward that left the room). */
export function hardReload(): void {
  window.location.reload();
}

export interface AnchorClick {
  href: string;
  currentHref: string;
  target: string | null;
  hasDownload: boolean;
  button: number;
  hasModifier: boolean;
  defaultPrevented: boolean;
}

/**
 * The URL a click must be turned into a full navigation for, or null when the
 * browser already handles it as one (new tab, download, modifier, external
 * origin) or it stays on the room document (same path, e.g. a #hash).
 */
export function hardExitTarget(click: AnchorClick): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.hasModifier || click.hasDownload) return null;
  if (click.target && click.target !== '_self') return null;
  let url: URL;
  let current: URL;
  try {
    current = new URL(click.currentHref);
    url = new URL(click.href, current);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname) return null;
  return url.href;
}

/**
 * The URL a history.pushState/replaceState call must be turned into a full
 * navigation for, or null when it stays on the room document (same path, e.g.
 * a query or hash update, or Next's own same-URL state writes).
 *
 * This is the backstop for PROGRAMMATIC exits (Next router push / replace
 * from the navbar search, notifications, redirects): Next's App Router commits
 * every soft navigation through window.history.pushState/replaceState, so
 * intercepting it catches exits that never produce an anchor click.
 */
export function historyExitTarget(url: string | URL | null | undefined, currentHref: string): string | null {
  if (url === null || url === undefined) return null;
  let next: URL;
  let current: URL;
  try {
    current = new URL(currentHref);
    next = new URL(url, current);
  } catch {
    return null;
  }
  // A cross-origin URL makes pushState throw anyway; let the browser do that.
  if (next.origin !== current.origin) return null;
  if (next.pathname === current.pathname) return null;
  return next.href;
}
