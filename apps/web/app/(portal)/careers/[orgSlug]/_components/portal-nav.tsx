'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { isPilotScope } from '../../../../../lib/launch-scope';
import { OrgLogo } from '../../../../../components/org-logo';
import { Button } from '../../../../../components/button';

interface PortalNavProps {
  orgName: string;
  orgSlug: string;
  /** `organizations.logo`; the org name is shown when it is missing or would not load. */
  orgLogo?: string | null;
}

type NavKey = 'navHome' | 'navVacancies' | 'navBenefits';
// Section anchors: plain links with no "current" state, since a click-only underline told people nothing
// about where they were (color.md › Best practices: red is reserved for attention).

const navLinks: ReadonlyArray<{ key: NavKey; href: string }> = [
  { key: 'navHome', href: '#' },
  { key: 'navVacancies', href: '#vacantes' },
  { key: 'navBenefits', href: '#beneficios' },
];
// The '#beneficios' section is not rendered under the pilot launch scope, so neither is its anchor.
const visibleNavLinks = isPilotScope() ? navLinks.filter((l) => l.href !== '#beneficios') : navLinks;

export function PortalNav({ orgName, orgSlug, orgLogo = null }: PortalNavProps) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <nav className="sticky top-0 z-50 h-14 w-full border-b border-border bg-white sm:h-[72px]">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
        {/* Left: organization brand + nav links */}
        <div className="flex min-w-0 items-center gap-8">
          <Link href={`/careers/${orgSlug}`} className="flex min-w-0 items-center gap-2.5">
            <OrgLogo
              logo={orgLogo}
              name={orgName}
              imgClassName="h-9 w-auto max-w-[140px] object-contain"
              fallbackClassName="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-subheading font-bold text-white"
              decorative
            />
            <span className="truncate font-display text-subheading font-semibold text-brand sm:text-heading">
              {orgName}
            </span>
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            {visibleNavLinks.map((link) => (
              <a
                key={link.key}
                href={link.href}
                className="flex h-[72px] items-center border-b-2 border-transparent text-body text-secondary transition-colors hover:border-brand hover:text-brand"
              >
                {p[link.key]}
              </a>
            ))}
          </div>
        </div>

        {/* Right: the candidate's own applications (the dashboard sends a signed-out visitor to the
            portal login), then a jump to the vacancy list. */}
        <div className="flex shrink-0 items-center gap-4">
          {/* Below sm the button shrinks to its icon (the label stays its accessible name), so the
              organisation's name has the row (branding.md). */}
          <Button
            href={`/careers/${orgSlug}/dashboard`}
            variant="secondary"
            className="max-sm:min-w-11 max-sm:gap-0 max-sm:px-2.5"
            icon={
              <svg
                className="size-4 shrink-0 sm:hidden"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
              </svg>
            }
          >
            <span className="max-sm:sr-only">{p.signInNav}</span>
          </Button>

          {/* The page's one primary: navy, like every other primary (red means attention). */}
          <Button href="#vacantes" variant="primary" className="hidden sm:inline-flex">
            {p.navVacancies}
          </Button>
        </div>
      </div>
    </nav>
  );
}
