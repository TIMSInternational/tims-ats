// Helpers for opening a candidate document through a short-lived signed link.

export type DocumentOpenErrorKey = 'documentUnavailable' | 'documentForbidden' | 'documentOpenFailed';

/** Maps a candidate.getDocumentUrl failure to an i18n key under `candidates`. Never shows raw server text. */
export function documentOpenErrorKey(err: unknown): DocumentOpenErrorKey {
  const data = (err as { data?: { code?: unknown } } | null)?.data;
  const code = typeof data?.code === 'string' ? data.code : undefined;
  if (code === 'NOT_FOUND' || code === 'PRECONDITION_FAILED') return 'documentUnavailable';
  if (code === 'FORBIDDEN') return 'documentForbidden';
  return 'documentOpenFailed';
}

/**
 * Opens a blank tab synchronously (inside the click gesture) and severs its opener, so the signed URL
 * can be loaded into it after the async request without being popup-blocked. Null if the browser
 * refused the tab.
 */
export function reserveNewTab(): Window | null {
  const tab = window.open('about:blank', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

/** Loads the signed URL into the reserved tab, or falls back to a `noopener` link click. */
export function openSignedUrlInNewTab(url: string, tab: Window | null): void {
  if (tab && !tab.closed) {
    tab.location.replace(url);
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}
