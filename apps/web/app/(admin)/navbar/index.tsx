'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../../lib/i18n';
import { resolveBreadcrumb, type Crumb } from '../../../lib/nav/breadcrumbs';
import { IconButton } from '../../../components/icon-button';
import { Menu } from '../../../components/menu';
import { SearchCommand } from './search-command';
import { NotificationDropdown } from './notification-dropdown';
import { SupportEmailLink } from './support-email-link';

// Language names are shown in their own language (endonyms), whatever the UI locale. No flags: a flag
// names a country, not a language (icons.md › Best practices).
const LANGUAGES = [
  { code: 'ES' as const, label: 'Español' },
  { code: 'EN' as const, label: 'English' },
];

export function Navbar({
  isPlatformOwner = false,
  onMenuClick,
  menuOpen,
}: {
  isPlatformOwner?: boolean;
  onMenuClick?: () => void;
  /** Whether the sidebar drawer is open (below lg), for the hamburger's aria-expanded. */
  menuOpen?: boolean;
}) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();

  const crumb = resolveBreadcrumb(pathname, t.breadcrumbs as Record<string, Crumb>);
  const currentLanguage = LANGUAGES.find((l) => l.code === locale)?.label ?? locale;

  // A useful window title per page (toolbars.md › Titles: "Don't title windows with your app name").
  // Detail pages inherit their list page's crumb.
  const crumbLabel = crumb?.label;
  const productName = t.auth.platformName;
  useEffect(() => {
    document.title = crumbLabel ? `${crumbLabel} · ${productName}` : productName;
  }, [crumbLabel, productName]);

  return (
    <header className="tims-chrome flex min-h-10 shrink-0 items-center justify-between gap-2 px-2 lg:px-3">
      <div className="flex min-w-0 items-center gap-1.5">
        {/* Hamburger — opens the sidebar drawer below lg */}
        <IconButton
          label={t.nav.menu}
          variant="chrome"
          size="sm"
          onClick={onMenuClick}
          aria-expanded={menuOpen}
          hideTooltip
          className="-ml-1 mr-1 lg:hidden"
        >
          <svg
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </IconButton>
        {crumb && (
          <nav aria-label={t.nav.breadcrumb} className="min-w-0">
            <ol className="flex min-w-0 items-center gap-1.5">
              {crumb.parent && (
                <li className="hidden items-center gap-1.5 md:flex">
                  <span className="text-callout text-[var(--chrome-text-tertiary)]">{crumb.parent}</span>
                  <svg
                    className="size-3 text-[var(--chrome-text-light)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </li>
              )}
              <li className="min-w-0">
                <span
                  aria-current="page"
                  className="block truncate text-callout font-semibold text-[var(--chrome-text-primary)]"
                >
                  {crumb.label}
                </span>
              </li>
            </ol>
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* The global search is the platform-owner cross-tenant search (platformProcedure / PlatformOwnerGate):
            a tenant user can only ever get a FORBIDDEN from it, so it is not rendered for them at all — no
            broken box, and no denied request (and authz_denied audit event) per keystroke. */}
        {isPlatformOwner && (
          <div className="hidden md:block">
            <SearchCommand />
          </div>
        )}

        <NotificationDropdown isPlatformOwner={isPlatformOwner} />

        {/* Support: mailto link, hidden when no support address is configured */}
        <SupportEmailLink />

        <Menu
          label={`${t.nav.language}: ${currentLanguage}`}
          selectedKey={locale}
          panelClassName="w-40"
          triggerClassName="flex h-7 items-center gap-1.5 rounded-[var(--r-md)] px-2 text-[var(--chrome-text-secondary)] transition-colors hover:bg-[var(--chrome-hover)] aria-expanded:bg-[var(--chrome-hover)] pointer-coarse:h-11"
          trigger={
            <>
              <span className="text-callout font-medium">{locale}</span>
              <svg
                className="size-3 text-[var(--chrome-text-tertiary)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </>
          }
          items={LANGUAGES.map((l) => ({ key: l.code, label: l.label, onSelect: () => setLocale(l.code) }))}
        />
      </div>
    </header>
  );
}
