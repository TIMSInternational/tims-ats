'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { PlatformSidebar } from './platform-sidebar';
import { ParticipantSidebar } from './participant-sidebar';
import { ParticipantTabBar } from './participant-tab-bar';
import { ShellDrawer } from './shell-drawer';
import { pickSidebarVariant, type Shell } from '../../lib/nav/manifest';
import { Navbar } from './navbar/index';
import { ImpersonationBanner } from './impersonation-banner';
import { TRPCProvider } from '../../lib/trpc-provider';
import { I18nProvider } from '../../lib/i18n';
import { PermissionsProvider, RouteAccessGuard } from '../../lib/permissions';
import { TenantLocaleProvider } from '../../lib/tenant-locale-context';

const SIDEBAR_KEY = 'tims-sidebar-expanded';

export function AdminShell({
  children,
  userInitials,
  displayName,
  isPlatformOwner,
  shell,
  avatar,
}: {
  children: React.ReactNode;
  userInitials: string;
  displayName: string;
  isPlatformOwner: boolean;
  shell: Shell;
  avatar?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== null) setExpanded(saved === 'true');
    setMounted(true);
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Escape, the focus trap and focus return live in ShellDrawer.
  // The drawer only exists below lg: close it if the window grows past the breakpoint while open.
  useEffect(() => {
    if (!mobileOpen || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = () => query.matches && setMobileOpen(false);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [mobileOpen]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
  };

  const variant = pickSidebarVariant(isPlatformOwner, shell);
  const isParticipant = variant === 'participant';
  const SidebarComponent =
    variant === 'platform' ? PlatformSidebar : variant === 'participant' ? ParticipantSidebar : Sidebar;

  return (
    <I18nProvider>
      <TRPCProvider>
        <PermissionsProvider isPlatformOwner={isPlatformOwner}>
          <TenantLocaleProvider enabled={!isPlatformOwner}>
            <div className="flex h-dvh overflow-hidden bg-[var(--chrome-bg)]">
              {/* Drawer backdrop (below lg) */}
              {mobileOpen && (
                <div
                  className="fixed inset-0 z-30 bg-black/40 animate-fade-in lg:hidden"
                  onClick={() => setMobileOpen(false)}
                  aria-hidden
                />
              )}
              {/* Sidebar: static from lg (a 220px sidebar leaves too little content at 768px), an off-canvas
            drawer below. Closed, the drawer is invisible, so it is out of the tab order and the a11y tree. */}
              <ShellDrawer open={mobileOpen} onClose={() => setMobileOpen(false)}>
                {/* The drawer always shows the expanded sidebar: the collapsed rail (icons only, labels in hover
              tooltips) is a desktop preference and is unusable on touch. */}
                <SidebarComponent
                  userInitials={userInitials}
                  displayName={displayName}
                  expanded={expanded || mobileOpen}
                  onToggle={handleToggle}
                  onClose={() => setMobileOpen(false)}
                  ready={mounted}
                  avatar={avatar}
                />
              </ShellDrawer>
              <div
                inert={mobileOpen || undefined}
                className={`flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-2 lg:pl-0 lg:pr-3 lg:pb-3 ${isParticipant ? 'max-lg:pb-18' : ''}`}
              >
                <ImpersonationBanner />
                <Navbar
                  isPlatformOwner={isPlatformOwner}
                  onMenuClick={() => setMobileOpen(true)}
                  menuOpen={mobileOpen}
                />
                <main className="flex-1 min-h-0 flex flex-col bg-[var(--content-bg-panel)] border border-[var(--content-border-default)] rounded-[var(--r-lg)] overflow-hidden">
                  <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <RouteAccessGuard>{children}</RouteAccessGuard>
                  </div>
                </main>
              </div>
              {isParticipant && <ParticipantTabBar />}
            </div>
          </TenantLocaleProvider>
        </PermissionsProvider>
      </TRPCProvider>
    </I18nProvider>
  );
}
