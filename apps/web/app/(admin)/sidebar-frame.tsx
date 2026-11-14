'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useI18n } from '../../lib/i18n';
import { SidebarCollapseToggle } from './sidebar-collapse-toggle';
import { SidebarDrawerClose } from './sidebar-drawer-close';
import { SidebarProfileMenu } from './sidebar-profile-menu';
import { SidebarNavLink, type SidebarNavItem } from './sidebar-nav-link';

export interface SidebarFrameSection {
  label: string | null;
  items: SidebarNavItem[];
}

export interface SidebarFrameProps {
  sections: SidebarFrameSection[];
  expanded: boolean;
  onToggle: () => void;
  onClose?: () => void;
  ready: boolean;
  userInitials: string;
  displayName: string;
  roleLabel: string;
  avatar?: string | null;
}

/**
 * The chrome every sidebar variant shares: logo bar, collapse toggle (desktop), drawer close (phones and
 * tablets), the named nav landmark and the profile menu. The three sidebars only differ in their sections.
 */
export function SidebarFrame({
  sections,
  expanded,
  onToggle,
  onClose,
  ready,
  userInitials,
  displayName,
  roleLabel,
  avatar,
}: SidebarFrameProps) {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const activeHref = sections.flatMap((s) => s.items).find((i) => i.active)?.href;

  // Keep the current page visible in a long nav (e.g. a settings page under the profile footer).
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeHref]);

  return (
    <aside
      className={`tims-sidebar flex h-full shrink-0 flex-col overflow-hidden bg-[var(--chrome-bg)] ${
        expanded ? 'w-[var(--sidebar-w-expanded)]' : 'w-[var(--sidebar-w-collapsed)]'
      } ${ready ? 'transition-[width] duration-200 ease-out' : ''}`}
    >
      <div
        className={`flex shrink-0 items-center justify-between ${expanded ? 'px-3.5 py-3' : 'justify-center px-1.5 py-3'}`}
      >
        <Link
          href="/dashboard"
          aria-label={expanded ? undefined : t.nav.dashboard}
          className="flex items-center overflow-hidden rounded-[var(--r-sm)]"
        >
          {expanded ? (
            <img src="/logo_tims.png" alt="TIMS International" className="h-7 brightness-0 invert" />
          ) : (
            <div className="flex size-7 items-center justify-center rounded-[var(--r-md)] bg-brand-red">
              <span className="text-callout font-bold text-white" aria-hidden="true">
                T
              </span>
            </div>
          )}
        </Link>
        {expanded && (
          <div className="hidden lg:flex">
            <SidebarCollapseToggle
              expanded={expanded}
              onToggle={onToggle}
              collapseLabel={t.nav.collapse}
              expandLabel={t.nav.expand}
            />
          </div>
        )}
        {onClose && <SidebarDrawerClose onClose={onClose} label={t.nav.closeMenu} />}
      </div>
      {!expanded && (
        <div className="flex justify-center pb-2">
          <SidebarCollapseToggle
            expanded={expanded}
            onToggle={onToggle}
            collapseLabel={t.nav.collapse}
            expandLabel={t.nav.expand}
          />
        </div>
      )}

      <nav
        ref={navRef}
        aria-label={t.nav.mainNav}
        className="flex flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-2 py-1"
      >
        {sections.map((section, si) => (
          <div key={si}>
            {expanded && section.label && (
              <p className="whitespace-nowrap px-2 pb-1.5 text-caption font-semibold uppercase tracking-wider text-[var(--chrome-text-tertiary)]">
                {section.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <SidebarNavLink key={item.href} item={item} expanded={expanded} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={`shrink-0 border-t border-[var(--chrome-border-light)] ${expanded ? 'p-2' : 'p-1.5'}`}>
        <SidebarProfileMenu
          userInitials={userInitials}
          displayName={displayName}
          roleLabel={roleLabel}
          avatar={avatar}
          expanded={expanded}
          securityLabel={t.nav.security}
          logoutLabel={t.nav.logout}
        />
      </div>
    </aside>
  );
}
