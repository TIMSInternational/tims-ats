'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';

// Mirrors the useClickOutside hook already used in apps/web/app/(admin)/navbar/index.tsx —
// a document-level mousedown listener, not onBlur (onBlur only fires when focus moves to
// another focusable element; clicking a plain, non-focusable area of the page would leave
// the menu stuck open).
function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

export function SidebarProfileMenu({
  userInitials,
  displayName,
  roleLabel,
  avatar,
  expanded,
  securityLabel,
  logoutLabel,
}: {
  userInitials: string;
  displayName: string;
  roleLabel: string;
  avatar?: string | null;
  expanded: boolean;
  securityLabel: string;
  logoutLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false));

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2.5 w-full rounded-[var(--r-lg)] text-[var(--chrome-text-primary)] hover:bg-[var(--chrome-hover)] transition-colors ${
          expanded ? 'px-2 py-2' : 'justify-center px-1 py-1.5'
        }`}
      >
        {avatar ? (
          <img src={avatar} alt="" className="w-7 h-7 rounded-[var(--r-md)] shrink-0 object-cover" />
        ) : (
          <div className="w-7 h-7 rounded-[var(--r-md)] bg-[#DD0C15] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
            {userInitials}
          </div>
        )}
        {expanded && (
          <>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-[12px] font-semibold truncate">{displayName}</p>
              <p className="text-[10px] text-[var(--chrome-text-tertiary)] truncate">{roleLabel}</p>
            </div>
            <svg className="w-3 h-3 text-[var(--chrome-text-light)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div
          className={`w-[190px] bg-[var(--content-bg-panel)] border border-[var(--content-border-light)] rounded-[var(--r-lg)] shadow-[2px_4px_16px_rgba(0,0,0,0.14),0_2px_4px_rgba(0,0,0,0.06)] p-1 z-50 ${
            expanded ? 'absolute bottom-[calc(100%+4px)] left-2' : 'fixed bottom-2 left-[calc(var(--sidebar-w-collapsed)+8px)]'
          }`}
        >
          <Link
            href="/mfa"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 h-[30px] px-2 rounded-[var(--r-sm)] text-[12px] text-[var(--content-font-secondary)] hover:bg-[var(--content-bg-hover)] transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-[var(--content-font-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            {securityLabel}
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full h-[30px] px-2 rounded-[var(--r-sm)] text-[12px] text-[var(--content-font-secondary)] hover:bg-[var(--content-bg-hover)] transition-colors text-left"
          >
            <svg className="w-3.5 h-3.5 text-[var(--content-font-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {logoutLabel}
          </button>
        </div>
      )}
    </div>
  );
}
