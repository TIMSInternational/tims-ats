'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { isPilotScope } from '../../../../../lib/launch-scope';
import { OrgLogo } from '../../../../../components/org-logo';

interface PortalNavProps {
  orgName: string;
  orgSlug: string;
  /** `organizations.logo`; the org name is shown when it is missing or would not load. */
  orgLogo?: string | null;
}

type NavKey = 'navHome' | 'navVacancies' | 'navBenefits';

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
  const [activeLink, setActiveLink] = useState<NavKey>('navHome');

  return (
    <nav className="sticky top-0 z-50 h-[72px] w-full border-b border-[#EDEDED] bg-white">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-6">
        {/* Left: organization brand + nav links */}
        <div className="flex min-w-0 items-center gap-8">
          <Link href={`/careers/${orgSlug}`} className="flex min-w-0 items-center gap-2.5">
            <OrgLogo
              logo={orgLogo}
              name={orgName}
              imgClassName="h-9 w-auto max-w-[140px] object-contain"
              fallbackClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1F114C] text-[14px] font-bold text-white"
              decorative
            />
            <span className="truncate text-[15px] font-semibold text-[#1F114C]">{orgName}</span>
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            {visibleNavLinks.map((link) => (
              <a
                key={link.key}
                href={link.href}
                onClick={() => setActiveLink(link.key)}
                className={`flex h-[72px] items-center text-[13px] transition-colors ${
                  activeLink === link.key
                    ? 'border-b-2 border-[#DD0C15] font-medium text-[#1F114C]'
                    : 'text-[#585858] hover:text-[#1F114C]'
                }`}
              >
                {p[link.key]}
              </a>
            ))}
          </div>
        </div>

        {/* Right: the candidate's own applications (the dashboard sends a signed-out visitor to the
            portal login), then a jump to the vacancy list. */}
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href={`/careers/${orgSlug}/dashboard`}
            className="rounded-lg border border-[#1F114C] px-4 py-2 text-[13px] font-medium text-[#1F114C] transition-colors hover:bg-[#1F114C] hover:text-white"
          >
            {p.signInNav}
          </Link>

          <Link
            href="#vacantes"
            className="hidden rounded-lg bg-[#DD0C15] px-4 py-2 text-[13px] font-medium text-white shadow-md transition-colors hover:bg-[#c40a12] sm:block"
          >
            {p.navVacancies}
          </Link>
        </div>
      </div>
    </nav>
  );
}
