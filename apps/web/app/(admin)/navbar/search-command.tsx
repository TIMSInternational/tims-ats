'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardSearch } from '../../../lib/platform-api/dashboard';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';

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

export function SearchCommand({ onFocus }: { onFocus?: () => void }) {
  const router = useRouter();
  const { t } = useI18n();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useClickOutside(searchRef, () => setSearchFocused(false));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  const searchResults = useDashboardSearch(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 1 && searchFocused },
  );

  const hasResults =
    searchResults.data &&
    (searchResults.data.organizations.length > 0 ||
      searchResults.data.users.length > 0 ||
      searchResults.data.pages.length > 0);

  const showDropdown = searchFocused && searchQuery.length >= 1;

  return (
    <div ref={searchRef} className="relative">
      <svg
        className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={t.nav.search}
        onFocus={() => {
          setSearchFocused(true);
          onFocus?.();
        }}
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
          onMouseDown={(e) => {
            e.preventDefault();
            setSearchQuery('');
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B8B8B] hover:text-[#585858]"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[#EDEDED] z-50 overflow-hidden max-h-[420px] overflow-y-auto">
          {searchResults.isLoading ? (
            <div className="px-4 py-6 text-center">
              <div className="w-5 h-5 border-2 border-[#1F114C]/20 border-t-[#1F114C] rounded-full animate-spin mx-auto mb-2" />
              <p className="text-[11px] text-[#8B8B8B]">{t.nav.searching}</p>
            </div>
          ) : searchResults.isError ? (
            <ErrorState onRetry={() => searchResults.refetch()} />
          ) : !hasResults ? (
            <div className="px-4 py-6 text-center">
              <svg
                className="w-8 h-8 text-[#EDEDED] mx-auto mb-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <p className="text-[12px] text-[#8B8B8B]">
                {t.nav.noSearchResults} &quot;{searchQuery}&quot;
              </p>
            </div>
          ) : (
            <>
              {searchResults.data!.pages.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-[#8B8B8B] uppercase tracking-wider bg-[#FAFAFA]">
                    {t.nav.pages}
                  </div>
                  {searchResults.data!.pages.map((page) => (
                    <button
                      key={page.href}
                      onMouseDown={() => {
                        router.push(page.href);
                        setSearchFocused(false);
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F6F6F6] transition-colors"
                    >
                      <svg
                        className="w-4 h-4 text-[#8B8B8B] shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        viewBox="0 0 24 24"
                      >
                        <path d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                      <span className="text-[12px] text-[#333]">{page.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {searchResults.data!.organizations.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-[#8B8B8B] uppercase tracking-wider bg-[#FAFAFA]">
                    {t.nav.organizations}
                  </div>
                  {searchResults.data!.organizations.map((org) => (
                    <button
                      key={org.id}
                      onMouseDown={() => {
                        router.push('/platform/organizations');
                        setSearchFocused(false);
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F6F6F6] transition-colors"
                    >
                      <div className="w-7 h-7 rounded-lg bg-[#1F114C]/10 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-[#1F114C]">
                          {org.name.substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-[#333] font-medium truncate">{org.name}</p>
                        <p className="text-[10px] text-[#8B8B8B]">
                          {org.slug} · {org.plan}
                        </p>
                      </div>
                      {!org.isActive && (
                        <span className="text-[9px] text-[#DD0C15] bg-red-50 px-1.5 py-0.5 rounded font-medium">
                          {t.nav.suspended}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {searchResults.data!.users.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-[#8B8B8B] uppercase tracking-wider bg-[#FAFAFA]">
                    {t.nav.users}
                  </div>
                  {searchResults.data!.users.map((user) => (
                    <button
                      key={user.id}
                      onMouseDown={() => {
                        router.push('/platform/users');
                        setSearchFocused(false);
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F6F6F6] transition-colors"
                    >
                      {user.avatar ? (
                        <img src={user.avatar} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-blue-600">
                            {user.firstName[0]}
                            {user.lastName[0]}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-[#333] font-medium truncate">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-[10px] text-[#8B8B8B] truncate">
                          {user.email}
                          {user.organization ? ` · ${user.organization.name}` : ''}
                        </p>
                      </div>
                      {user.isPlatformOwner && (
                        <span className="text-[9px] text-[#1F114C] bg-[#1F114C]/10 px-1.5 py-0.5 rounded font-medium">
                          {t.nav.owner}
                        </span>
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
  );
}
