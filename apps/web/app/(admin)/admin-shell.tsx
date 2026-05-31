'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './sidebar';
import { PlatformSidebar } from './platform-sidebar';
import { Navbar } from './navbar';
import { SupportChat } from './support-chat';
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

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== null) setExpanded(saved === 'true');
    setMounted(true);
  }, []);

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
        <SidebarComponent
          userInitials={userInitials}
          displayName={displayName}
          expanded={expanded}
          onToggle={handleToggle}
          ready={mounted}
          avatar={avatar}
        />
        <div className="flex flex-col flex-1 min-w-0">
          <Navbar isPlatformOwner={isPlatformOwner} onHelpClick={() => setChatOpen(!chatOpen)} />
          <main className="flex-1 overflow-y-auto bg-[#F6F6F6]">
            {children}
          </main>
        </div>
      </div>
      <SupportChat open={chatOpen} onClose={() => setChatOpen(false)} />
    </TRPCProvider>
    </I18nProvider>
  );
}
