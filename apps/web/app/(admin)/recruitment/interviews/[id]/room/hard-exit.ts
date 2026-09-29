// The interview room is served with a relaxed CSP (Daily call object, see
// apps/web/lib/security/csp.ts). CSP belongs to the DOCUMENT, so any soft
// (client-side) navigation out of the room would carry that relaxed policy
// onto the rest of the app. Every exit must therefore be a full document load.

export const ROOM_EXIT_PATH = '/recruitment/interviews';

/** Leave the room with a full document navigation (never a client-side router transition). */
export function hardNavigate(path: string): void {
  window.location.assign(path);
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
