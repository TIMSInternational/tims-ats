'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../lib/i18n';
import { useDismissable } from '../../lib/use-dismissable';

const ITEM =
  'flex w-full min-h-8 items-center gap-2 rounded-[var(--r-sm)] px-2 text-left text-body text-[var(--content-font-secondary)] transition-colors hover:bg-[var(--content-bg-hover)] pointer-coarse:min-h-11';
const ITEM_ICON = 'size-4 shrink-0 text-[var(--content-font-tertiary)]';

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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Outside click and Escape close the menu; Escape returns focus to the trigger (popovers.md).
  useDismissable(open, wrapRef, () => setOpen(false), triggerRef);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      event.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  };

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={expanded ? undefined : displayName}
        title={expanded ? undefined : displayName}
        className={`flex w-full items-center gap-2.5 rounded-[var(--r-lg)] text-[var(--chrome-text-primary)] transition-colors hover:bg-[var(--chrome-hover)] ${
          expanded ? 'px-2 py-2' : 'justify-center px-1 py-1.5'
        }`}
      >
        {avatar ? (
          <img src={avatar} alt="" className="size-7 shrink-0 rounded-[var(--r-md)] object-cover" />
        ) : (
          <div
            aria-hidden={expanded ? undefined : true}
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-brand-red text-caption font-bold text-white"
          >
            {userInitials}
          </div>
        )}
        {expanded && (
          <>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-callout font-semibold">{displayName}</p>
              <p className="truncate text-caption text-[var(--chrome-text-tertiary)]">{roleLabel}</p>
            </div>
            <svg
              className="size-3 shrink-0 text-[var(--chrome-text-tertiary)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={displayName}
          onKeyDown={onMenuKeyDown}
          className={`tims-surface z-50 w-[200px] rounded-[var(--r-lg)] border border-[var(--content-border-light)] bg-[var(--content-bg-panel)] p-1 shadow-popover ${
            expanded
              ? 'absolute bottom-[calc(100%+4px)] left-2'
              : 'fixed bottom-2 left-[calc(var(--sidebar-w-collapsed)+8px)]'
          }`}
        >
          {/* Own profile (D-16): name, phone, language and time zone. */}
          <Link href="/profile" role="menuitem" tabIndex={-1} onClick={() => setOpen(false)} className={ITEM}>
            <svg
              className={ITEM_ICON}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            {t.profile.menuLabel}
          </Link>
          <Link href="/mfa" role="menuitem" tabIndex={-1} onClick={() => setOpen(false)} className={ITEM}>
            <svg
              className={ITEM_ICON}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            {securityLabel}
          </Link>
          <div role="separator" className="my-1 h-px bg-[var(--content-border-light)]" />
          <button type="button" role="menuitem" tabIndex={-1} onClick={handleLogout} className={ITEM}>
            <svg
              className={ITEM_ICON}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {logoutLabel}
          </button>
        </div>
      )}
    </div>
  );
}
