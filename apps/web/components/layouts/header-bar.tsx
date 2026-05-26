"use client";

import * as React from "react";
import { Bell, Search, ChevronDown, LogOut, Settings, User } from "lucide-react";
import { cn } from "@tims/ui";

export interface HeaderUser {
  name: string;
  email: string;
  avatar?: string;
}

export interface HeaderBarProps {
  user?: HeaderUser;
  onMenuToggle?: () => void;
  className?: string;
}

function UserAvatar({ user }: { user: HeaderUser }) {
  const initials = user.name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  if (user.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatar}
        alt={user.name}
        className="h-8 w-8 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold select-none">
      {initials}
    </span>
  );
}

export function HeaderBar({ user, className }: HeaderBarProps) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);
  const notifRef = React.useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header
      className={cn(
        "flex h-14 items-center justify-between gap-4 border-b border-border bg-background px-4",
        className
      )}
    >
      {/* Global search */}
      <div className="flex flex-1 items-center gap-3 max-w-sm">
        {searchOpen ? (
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="search"
              placeholder="Search people, jobs, documents…"
              onBlur={() => setSearchOpen(false)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors w-full max-w-xs"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline truncate">Search…</span>
            <kbd className="ml-auto hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
        )}
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-1">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notifications"
            aria-expanded={notifOpen}
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Bell className="h-4 w-4" />
            {/* Unread dot */}
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-foreground">Notifications</p>
                <button className="text-xs text-primary hover:underline">Mark all read</button>
              </div>
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {[
                  { title: "New application received", time: "2m ago", unread: true },
                  { title: "Interview scheduled for tomorrow", time: "1h ago", unread: true },
                  { title: "Offer letter sent to Ana G.", time: "3h ago", unread: false },
                ].map((n, i) => (
                  <button
                    key={i}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                      n.unread && "bg-primary/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-foreground">{n.title}</p>
                      {n.unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground">{n.time}</p>
                  </button>
                ))}
              </div>
              <div className="border-t border-border px-4 py-2.5">
                <button className="text-xs text-primary hover:underline w-full text-center">
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        {user && (
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-label="User menu"
              aria-expanded={userMenuOpen}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <UserAvatar user={user} />
              <span className="hidden md:flex flex-col items-start">
                <span className="text-sm font-medium text-foreground leading-none">{user.name}</span>
              </span>
              <ChevronDown className="hidden md:block h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
                {/* User info */}
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>

                {/* Menu items */}
                <div className="py-1">
                  {[
                    { icon: <User className="h-4 w-4" />, label: "Profile" },
                    { icon: <Settings className="h-4 w-4" />, label: "Settings" },
                  ].map((item) => (
                    <button
                      key={item.label}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                      <span className="text-muted-foreground">{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="border-t border-border py-1">
                  <button className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors">
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
