'use client';

import { useEffect } from 'react';
import { hardExitTarget, hardNavigate } from './hard-exit';

/**
 * Turns every in-app link click (including the admin shell's next/link sidebar
 * and navbar, which wrap this page) and every browser back/forward into a full
 * document navigation while the room is mounted, so the room's relaxed CSP is
 * never carried onto another page.
 */
export function HardExitGuard() {
  useEffect(() => {
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

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return null;
}
