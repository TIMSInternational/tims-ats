import Link from 'next/link';
import { useLegalLinks } from '../../../../../components/legal/use-legal-links';
import { useI18n } from '../../../../../lib/i18n';
import { isPilotScope } from '../../../../../lib/launch-scope';
import { LEGAL_DOCUMENT_SLUGS, isLegalPagesEnabled } from '../../../../../lib/legal/documents';
import { OrgLogo } from '../../../../../components/org-logo';

interface PortalFooterProps {
  orgName: string;
  orgSlug: string;
  /** `organizations.logo`; the org name is shown when it is missing or would not load. */
  orgLogo?: string | null;
}

export function PortalFooter({ orgName, orgSlug, orgLogo = null }: PortalFooterProps) {
  const { t } = useI18n();
  const p = t.portal;
  // The vendor blurb promises "evaluaciones científicas", which the pilot launch scope does not offer.
  const showVendorBlurb = !isPilotScope();
  // The platform's own legal documents follow the organization's notice only while
  // NEXT_PUBLIC_LEGAL_PAGES_ENABLED is on. The platform privacy notice gets its own label, so it is
  // never confused with the organization's candidate notice above it.
  const platformLinks = useLegalLinks(LEGAL_DOCUMENT_SLUGS).map((link) =>
    link.slug === 'privacy' ? { ...link, label: t.legal.platformPrivacyLink } : link,
  );
  const showPlatformLinks = isLegalPagesEnabled();
  const linkClass =
    'inline-flex min-h-7 items-center text-callout text-white/70 underline-offset-2 transition-colors hover:text-white hover:underline pointer-coarse:min-h-11';
  return (
    <footer className="bg-brand px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Top row */}
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          {/* Left: organization brand (+ vendor blurb outside the pilot) */}
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5">
              <OrgLogo
                logo={orgLogo}
                name={orgName}
                imgClassName="h-8 w-auto max-w-[140px] rounded bg-white object-contain p-1"
                fallbackClassName="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-body font-bold text-white"
                decorative
              />
              <span className="text-subheading font-semibold text-white">{orgName}</span>
            </div>
            {showVendorBlurb && (
              <p className="mt-3 text-callout leading-relaxed text-white/70">
                {orgName} {p.footerUsesTimsSuffix}
              </p>
            )}
          </div>

          {/* Right: the organization's candidate privacy notice (+ the platform legal pages when enabled). */}
          <nav aria-label={p.footerLegal}>
            <ul className="space-y-2">
              <li>
                <Link href={`/careers/${encodeURIComponent(orgSlug)}/privacy`} className={linkClass}>
                  {p.footerPrivacy}
                </Link>
              </li>
              {showPlatformLinks &&
                platformLinks.map((link) => (
                  <li key={link.slug}>
                    <Link href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  </li>
                ))}
            </ul>
          </nav>
        </div>

        {/* Bottom */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-caption text-white/70">
            &copy; {new Date().getFullYear()} {orgName}. {p.allRightsReserved}
          </p>
          <p className="text-caption text-white/70">
            {t.auth.poweredBy} <span className="font-semibold text-white">TIMS ATS</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
