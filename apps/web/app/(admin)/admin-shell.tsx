'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { PlatformSidebar } from './platform-sidebar';
import { Navbar } from './navbar/index';
import { SupportChat } from './support-chat';
import { ImpersonationBanner } from './impersonation-banner';
import { TRPCProvider } from '../../lib/trpc-provider';
import { I18nProvider } from '../../lib/i18n';

const SIDEBAR_KEY = 'tims-sidebar-expanded';

export function AdminShell({
  children,
  userInitials,
  displayName,
  isPlatformOwner,
  avatar,
}: {
  children: React.ReactNode;
  userInitials: string;
  displayName: string;
  isPlatformOwner: boolean;
  avatar?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
  };

  const SidebarComponent = isPlatformOwner ? PlatformSidebar : Sidebar;

  return (
    <I18nProvider>
    <TRPCProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}
        {/* Sidebar: static on md+, off-canvas drawer on mobile */}
        <div
          className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}
        >
          <SidebarComponent
            userInitials={userInitials}
            displayName={displayName}
            expanded={expanded}
            onToggle={handleToggle}
            ready={mounted}
            avatar={avatar}
          />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <ImpersonationBanner />
          <Navbar
            isPlatformOwner={isPlatformOwner}
            onHelpClick={() => setChatOpen(!chatOpen)}
            onMenuClick={() => setMobileOpen(true)}
          />
          <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#F6F6F6]">
            {children}
          </main>
        </div>
      </div>
      <SupportChat open={chatOpen} onClose={() => setChatOpen(false)} />
    </TRPCProvider>
    </I18nProvider>
  );
}
