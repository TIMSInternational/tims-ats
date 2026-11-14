'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardSearch } from '../../../lib/platform-api/dashboard';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components/error-state';
import { Spinner } from '../../../components/spinner';
import { useDismissable } from '../../../lib/use-dismissable';
import { isHrefHiddenInScope } from '../../../lib/launch-scope';

interface ResultOption {
  key: string;
  group: string;
  href: string;
  content: React.ReactNode;
}

const GROUP_LABEL = 'bg-surface-hover px-3 py-2 text-caption font-semibold text-secondary';

/**
 * Platform-owner global search: a combobox with a listbox of results (searching.md). Arrow keys move,
 * Enter opens, Escape (in the field) clears and closes; ⌘K / Ctrl+K focuses it from anywhere.
 */
export function SearchCommand({ onFocus }: { onFocus?: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const listId = `search-results-${useId()}`;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useDismissable(searchFocused, searchRef, () => setSearchFocused(false));

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
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const searchResults = useDashboardSearch(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 1 && searchFocused },
  );

  // The static page results come from the server's fixed page list (TS dashboard.helpers + C# search use
  // case), which knows nothing about the pilot launch scope — drop the ones the scope hides, or a result
  // like "Feature Flags" leads straight to AccessDenied.
  const pages = (searchResults.data?.pages ?? []).filter((page) => !isHrefHiddenInScope(page.href));
  const organizations = searchResults.data?.organizations ?? [];
  const users = searchResults.data?.users ?? [];

  const options: ResultOption[] = [
    ...pages.map((page) => ({
      key: `page-${page.href}`,
      group: t.nav.pages,
      href: page.href,
      content: (
        <>
          <svg
            className="size-4 shrink-0 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          <span className="text-body text-primary">{page.name}</span>
        </>
      ),
    })),
    ...organizations.map((org) => ({
      key: `org-${org.id}`,
      group: t.nav.organizations,
      href: '/platform/organizations',
      content: (
        <>
          <div aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-tint">
            <span className="text-caption font-bold text-brand">{org.name.substring(0, 2).toUpperCase()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-primary">{org.name}</p>
            <p className="text-caption text-muted">
              {org.slug} · {org.plan}
            </p>
          </div>
          {!org.isActive && (
            <span className="rounded bg-danger-bg px-1.5 py-0.5 text-caption font-medium text-danger">
              {t.nav.suspended}
            </span>
          )}
        </>
      ),
    })),
    ...users.map((user) => ({
      key: `user-${user.id}`,
      group: t.nav.users,
      href: '/platform/users',
      content: (
        <>
          {user.avatar ? (
            <img src={user.avatar} alt="" className="size-7 shrink-0 rounded-full object-cover" />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-info-bg"
            >
              <span className="text-caption font-bold text-info">
                {user.firstName[0]}
                {user.lastName[0]}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-primary">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate text-caption text-muted">
              {user.email}
              {user.organization ? ` · ${user.organization.name}` : ''}
            </p>
          </div>
          {user.isPlatformOwner && (
            <span className="rounded bg-brand-tint px-1.5 py-0.5 text-caption font-medium text-brand">
              {t.nav.owner}
            </span>
          )}
        </>
      ),
    })),
  ];

  const showDropdown = searchFocused && searchQuery.length >= 1;
  const showOptions = showDropdown && !searchResults.isLoading && !searchResults.isError && options.length > 0;

  const pick = (option: ResultOption) => {
    router.push(option.href);
    setSearchFocused(false);
    setSearchQuery('');
    setActiveIndex(-1);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setSearchFocused(false);
      setSearchQuery('');
      searchInputRef.current?.blur();
    } else if (showOptions && e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (showOptions && e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (showOptions && e.key === 'Enter') {
      const option = options[activeIndex] ?? options[0];
      if (option) {
        e.preventDefault();
        pick(option);
      }
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;
  const groups = [...new Set(options.map((o) => o.group))];

  return (
    <div ref={searchRef} className="relative">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        ref={searchInputRef}
        type="text"
        role="combobox"
        aria-label={t.nav.searchLabel}
        aria-expanded={showOptions}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showOptions && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={onInputKeyDown}
        placeholder={t.nav.search}
        maxLength={100}
        onFocus={() => {
          setSearchFocused(true);
          onFocus?.();
        }}
        className={`h-8 rounded-lg border border-border bg-surface-hover pl-9 pr-16 text-body text-primary placeholder:text-muted transition-[width] duration-200 ease-out ${
          searchFocused ? 'w-[320px]' : 'w-[200px]'
        }`}
      />
      {!searchFocused && (
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5" aria-hidden="true">
          <kbd className="rounded bg-border px-1 py-0.5 font-mono text-caption text-secondary">⌘K</kbd>
        </div>
      )}
      {searchFocused && searchQuery && (
        <button
          type="button"
          aria-label={t.common.clearSearch}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setSearchQuery('')}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-secondary"
        >
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      {showDropdown && (
        <div className="tims-surface absolute left-0 right-0 top-full z-50 mt-2 max-h-[420px] overflow-hidden overflow-y-auto rounded-xl border border-border bg-white shadow-popover">
          {searchResults.isLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-callout text-secondary" role="status">
              <Spinner className="size-4 text-brand" />
              {t.nav.searching}
            </div>
          ) : searchResults.isError ? (
            <ErrorState size="compact" error={searchResults.error} onRetry={() => searchResults.refetch()} />
          ) : options.length === 0 ? (
            <p role="status" className="px-4 py-6 text-center text-body text-secondary">
              {t.nav.noSearchResults} &quot;{searchQuery}&quot;
            </p>
          ) : null}
          <div id={listId} role="listbox" aria-label={t.nav.searchResults} hidden={!showOptions}>
            {groups.map((group, gi) => (
              <div key={group} role="group" aria-labelledby={`${listId}-group-${gi}`}>
                <div id={`${listId}-group-${gi}`} className={GROUP_LABEL}>
                  {group}
                </div>
                {options.map((option, index) =>
                  option.group !== group ? null : (
                    <div
                      key={option.key}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === activeIndex}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(option)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        index === activeIndex ? 'bg-surface' : 'hover:bg-surface'
                      }`}
                    >
                      {option.content}
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
