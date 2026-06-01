'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

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

function useTimeAgo() {
  const { t } = useI18n();
  return (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t.nav.now;
    if (minutes < 60) return t.nav.minutesAgo.replace('{n}', String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t.nav.hoursAgo.replace('{n}', String(hours));
    const days = Math.floor(hours / 24);
    return t.nav.daysAgo.replace('{n}', String(days));
  };
}

export function Navbar({ isPlatformOwner = false, onHelpClick }: { isPlatformOwner?: boolean; onHelpClick?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const timeAgo = useTimeAgo();

  const breadcrumbs = t.breadcrumbs as Record<string, { parent?: string; label: string }>;
  const crumb = breadcrumbs[pathname] || { label: 'TIMS Platform' };

  const [notifOpen, setNotifOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const notifRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useClickOutside(notifRef, () => setNotifOpen(false));
  useClickOutside(langRef, () => setLangOpen(false));
  useClickOutside(searchRef, () => setSearchFocused(false));

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // CMD+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearchFocused(false);
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const searchResults = trpc.platform.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 1 && searchFocused }
  );

  const hasResults = searchResults.data && (
    searchResults.data.organizations.length > 0 ||
    searchResults.data.users.length > 0 ||
    searchResults.data.pages.length > 0
  );

  const showDropdown = searchFocused && searchQuery.length >= 1;

  const { data: unreadData } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: notifData, refetch: refetchNotifs } = trpc.notification.list.useQuery(
    { limit: 10 },
    { enabled: notifOpen }
  );

  const markAsReadMutation = trpc.notification.markAsRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });

  const markAllAsReadMutation = trpc.notification.markAllAsRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notifData?.notifications ?? [];

  const handleNotifClick = (notif: { id: string; read: boolean; actionUrl?: string | null }) => {
    if (!notif.read) markAsReadMutation.mutate({ id: notif.id });
    if (notif.actionUrl) {
      router.push(notif.actionUrl);
      setNotifOpen(false);
    }
  };

  return (
    <header className="flex items-center justify-between px-6 h-[56px] bg-white border-b border-[#EDEDED] shrink-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5">
        {crumb.parent && (
          <>
            <span className="text-[13px] text-[#8B8B8B]">{crumb.parent}</span>
            <svg className="w-3.5 h-3.5 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </>
        )}
        <span className="text-[13px] font-medium text-[#1F114C]">{crumb.label}</span>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1.5">
        {/* Search */}
        <div ref={searchRef} className="relative">
          <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.nav.search}
            onFocus={() => { setSearchFocused(true); setNotifOpen(false); setLangOpen(false); }}
            className={`h-8 pl-9 pr-16 rounded-lg border border-[#EDEDED] bg-[#FAFAFA] text-[12px] text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20 focus:border-[#1F114C]/30 transition-all ${
              searchFocused ? 'w-[320px]' : 'w-[200px]'
            }`}
          />
          {!searchFocused && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              <kbd className="text-[9px] text-[#8B8B8B] bg-[#EDEDED] rounded px-1 py-0.5 font-mono">⌘K</kbd>
            </div>
          )}
          {searchFocused && searchQuery && (
            <button
              onMouseDown={(e) => { e.preventDefault(); setSearchQuery(''); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B8B8B] hover:text-[#585858]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}

          {/* Search Results Dropdown */}
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[#EDEDED] z-50 overflow-hidden max-h-[420px] overflow-y-auto">
              {searchResults.isLoading ? (
                <div className="px-4 py-6 text-center">
                  <div className="w-5 h-5 border-2 border-[#1F114C]/20 border-t-[#1F114C] rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-[11px] text-[#8B8B8B]">{t.nav.searching}</p>
                </div>
              ) : !hasResults ? (
                <div className="px-4 py-6 text-center">
                  <svg className="w-8 h-8 text-[#EDEDED] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                  <p className="text-[12px] text-[#8B8B8B]">{t.nav.noSearchResults} &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <>
                  {/* Pages */}
                  {searchResults.data!.pages.length > 0 && (
                    <div>
                      <div className="px-3 py-2 text-[10px] font-semibold text-[#8B8B8B] uppercase tracking-wider bg-[#FAFAFA]">{t.nav.pages}</div>
                      {searchResults.data!.pages.map((page) => (
                        <button
                          key={page.href}
                          onMouseDown={() => { router.push(page.href); setSearchFocused(false); setSearchQuery(''); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F6F6F6] transition-colors"
                        >
                          <svg className="w-4 h-4 text-[#8B8B8B] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                          <span className="text-[12px] text-[#333]">{page.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Organizations */}
                  {searchResults.data!.organizations.length > 0 && (
                    <div>
                      <div className="px-3 py-2 text-[10px] font-semibold text-[#8B8B8B] uppercase tracking-wider bg-[#FAFAFA]">{t.nav.organizations}</div>
                      {searchResults.data!.organizations.map((org) => (
                        <button
                          key={org.id}
                          onMouseDown={() => { router.push('/platform/organizations'); setSearchFocused(false); setSearchQuery(''); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F6F6F6] transition-colors"
                        >
                          <div className="w-7 h-7 rounded-lg bg-[#1F114C]/10 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-[#1F114C]">{org.name.substring(0, 2).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] text-[#333] font-medium truncate">{org.name}</p>
                            <p className="text-[10px] text-[#8B8B8B]">{org.slug} · {org.plan}</p>
                          </div>
                          {!org.isActive && (
                            <span className="text-[9px] text-[#DD0C15] bg-red-50 px-1.5 py-0.5 rounded font-medium">{t.nav.suspended}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Users */}
                  {searchResults.data!.users.length > 0 && (
                    <div>
                      <div className="px-3 py-2 text-[10px] font-semibold text-[#8B8B8B] uppercase tracking-wider bg-[#FAFAFA]">{t.nav.users}</div>
                      {searchResults.data!.users.map((user) => (
                        <button
                          key={user.id}
                          onMouseDown={() => { router.push('/platform/users'); setSearchFocused(false); setSearchQuery(''); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F6F6F6] transition-colors"
                        >
                          {user.avatar ? (
                            <img src={user.avatar} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-bold text-blue-600">{user.firstName[0]}{user.lastName[0]}</span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] text-[#333] font-medium truncate">{user.firstName} {user.lastName}</p>
                            <p className="text-[10px] text-[#8B8B8B] truncate">{user.email}{user.organization ? ` · ${user.organization.name}` : ''}</p>
                          </div>
                          {user.isPlatformOwner && (
                            <span className="text-[9px] text-[#1F114C] bg-[#1F114C]/10 px-1.5 py-0.5 rounded font-medium">{t.nav.owner}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => { setNotifOpen(!notifOpen); setLangOpen(false); }}
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              notifOpen ? 'bg-[#F6F6F6]' : 'hover:bg-[#F6F6F6]'
            }`}
          >
            <svg className="w-[18px] h-[18px] text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-[#DD0C15] text-white text-[8px] font-bold flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-[380px] bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[#EDEDED] z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEDED]">
                <h3 className="text-[13px] font-semibold text-[#1F114C]">
                  {t.nav.notifications}
                  {unreadCount > 0 && (
                    <span className="ml-1.5 text-[11px] font-normal text-[#8B8B8B]">({unreadCount} {t.nav.unread})</span>
                  )}
                </h3>
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllAsReadMutation.mutate()}
                    disabled={markAllAsReadMutation.isPending}
                    className="text-[11px] text-[#DD0C15] font-medium hover:underline disabled:opacity-50"
                  >
                    {t.nav.markAllRead}
                  </button>
                )}
              </div>

              <div className="max-h-[400px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center">
                    <svg className="w-10 h-10 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                      <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                    </svg>
                    <p className="text-[13px] text-[#8B8B8B]">{t.nav.noNotifications}</p>
                    <p className="text-[11px] text-[#ccc] mt-1">{t.nav.noNotificationsDesc}</p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotifClick(notif)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#FAFAFA] transition-colors border-b border-[#F6F6F6] last:border-0 ${
                        !notif.read ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        notif.type === 'critical' ? 'bg-[#DD0C15]' :
                        notif.type === 'warning' ? 'bg-amber-500' :
                        notif.type === 'success' ? 'bg-green-500' : 'bg-blue-500'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[12px] text-[#333] leading-snug ${!notif.read ? 'font-medium' : ''}`}>
                          {notif.title}
                        </p>
                        {notif.message && (
                          <p className="text-[11px] text-[#8B8B8B] mt-0.5 line-clamp-1">{notif.message}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-[#8B8B8B]">{timeAgo(notif.createdAt)}</span>
                          {notif.module && (
                            <span className="text-[9px] text-[#8B8B8B] bg-[#F6F6F6] rounded px-1.5 py-0.5">{notif.module}</span>
                          )}
                        </div>
                      </div>
                      {!notif.read && (
                        <div className="w-2 h-2 rounded-full bg-[#1F114C] mt-1.5 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>

              {notifications.length > 0 && (
                <div className="px-4 py-2.5 border-t border-[#EDEDED] bg-[#FAFAFA]">
                  <button
                    onClick={() => { router.push('/platform/notifications'); setNotifOpen(false); }}
                    className="text-[12px] text-[#1F114C] font-medium hover:underline w-full text-center"
                  >
                    {t.nav.viewAll}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Help */}
        <button
          onClick={onHelpClick}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[#F6F6F6] transition-colors"
          title={t.nav.helpCenter}
        >
          <svg className="w-[18px] h-[18px] text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        </button>

        {/* Language */}
        <div ref={langRef} className="relative">
          <button
            onClick={() => { setLangOpen(!langOpen); setNotifOpen(false); }}
            className={`h-8 px-2.5 rounded-lg border border-[#EDEDED] flex items-center gap-1.5 transition-colors ${
              langOpen ? 'bg-[#FAFAFA] border-[#ccc]' : 'hover:bg-[#FAFAFA]'
            }`}
          >
            <span className="text-[12px] text-[#585858] font-medium">{locale}</span>
            <svg className={`w-3 h-3 text-[#8B8B8B] transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {langOpen && (
            <div className="absolute right-0 top-full mt-2 w-[140px] bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[#EDEDED] z-50 overflow-hidden py-1">
              {[
                { code: 'ES' as const, label: 'Espanol', flag: '🇪🇸' },
                { code: 'EN' as const, label: 'English', flag: '🇺🇸' },
              ].map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLocale(l.code); setLangOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#FAFAFA] transition-colors ${
                    locale === l.code ? 'bg-[#F6F6F6]' : ''
                  }`}
                >
                  <span className="text-[14px]">{l.flag}</span>
                  <span className="text-[12px] text-[#333]">{l.label}</span>
                  {locale === l.code && (
                    <svg className="w-3.5 h-3.5 text-[#1F114C] ml-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
