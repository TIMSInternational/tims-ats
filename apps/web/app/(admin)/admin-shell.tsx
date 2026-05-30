'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './sidebar';
import { Navbar } from './navbar';

const SIDEBAR_KEY = 'tims-sidebar-expanded';

export function AdminShell({
  children,
  userInitials,
}: {
  children: React.ReactNode;
  userInitials: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [mounted, setMounted] = useState(false);

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        userInitials={userInitials}
        expanded={expanded}
        onToggle={handleToggle}
        ready={mounted}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <Navbar />
        <main className="flex-1 overflow-y-auto bg-[#F6F6F6]">
          {children}
        </main>
      </div>
    </div>
  );
}
