'use client';

import { useEffect } from 'react';
import { hardExitTarget, hardNavigate, historyExitTarget } from './hard-exit';

let isInstalled = false;

/**
 * Installs the room's exit interceptors ONCE for the lifetime of the document
 * and never removes them. CSP belongs to the document, not to the React tree:
 * if the room unmounts without a navigation (e.g. a render error caught by the
 * `(admin)/error.tsx` boundary, which keeps the admin shell mounted), the
 * relaxed policy is still in force, so every exit must stay a full load.
 * Idempotent, so StrictMode double effects and remounts do not double-wrap.
 */
function installRoomHardExit(): void {
  if (isInstalled) return;
  isInstalled = true;

  const onClick = (e: MouseEvent) => {
    const el = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!(el instanceof HTMLAnchorElement)) return;
    const next = hardExitTarget({
      href: el.href,
      currentHref: window.location.href,
      target: el.getAttribute('target'),
      hasDownload: el.hasAttribute('download'),
      button: e.button,
      hasModifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
      defaultPrevented: e.defaultPrevented,
    });
    if (!next) return;
    // Capture phase on document runs before React's root listener, so
    // next/link never gets to perform its soft navigation.
    e.preventDefault();
    e.stopPropagation();
    hardNavigate(next);
  };
  // Back/forward: the URL has already changed; reload it as a full document.
  const onPopState = () => window.location.reload();

  // Programmatic exits: Next commits every soft navigation through these.
  const history = window.history;
  const wrap =
    (original: History['pushState']): History['pushState'] =>
    (data, unused, url) => {
      const next = historyExitTarget(url, window.location.href);
      if (next) {
        hardNavigate(next);
        return;
      }
      original.call(history, data, unused, url);
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);

  document.addEventListener('click', onClick, true);
  window.addEventListener('popstate', onPopState);
}

/**
 * Turns every in-app link click (including the admin shell's next/link sidebar
 * and navbar, which wrap this page) and every browser back/forward into a full
 * document navigation once the room has mounted, so the room's relaxed CSP is
 * never carried onto another page.
 *
 * Programmatic exits (Next router push/replace from the navbar search, the
 * notification dropdown, redirects) produce no anchor click, so history
 * pushState/replaceState are also wrapped: any call that would leave the room
 * path is converted into a full document load instead of a history entry.
 */
export function HardExitGuard() {
  useEffect(() => {
    installRoomHardExit();
  }, []);

  return null;
}
