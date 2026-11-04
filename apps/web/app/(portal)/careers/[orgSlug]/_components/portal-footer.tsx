import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { isPilotScope } from '../../../../../lib/launch-scope';
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
  return (
    <footer className="bg-[#1F114C] px-8 py-8">
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
                fallbackClassName="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-[13px] font-bold text-white"
                decorative
              />
              <span className="text-[14px] font-semibold text-white">{orgName}</span>
            </div>
            {showVendorBlurb && (
              <p className="mt-3 text-[12px] leading-relaxed text-white/50">
                {orgName} {p.footerUsesTimsSuffix}
              </p>
            )}
          </div>

          {/* Right: the one page that exists for candidates before they apply — the privacy notice. */}
          <nav aria-label={p.footerLegal}>
            <ul className="space-y-2">
              <li>
                <Link
                  href={`/careers/${encodeURIComponent(orgSlug)}/privacy`}
                  className="text-[12px] text-white/70 underline-offset-2 transition-colors hover:text-white hover:underline"
                >
                  {p.footerPrivacy}
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* Bottom */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-[11px] text-white/40">
            &copy; {new Date().getFullYear()} {orgName}. {p.allRightsReserved}
          </p>
          <p className="text-[11px] text-white/40">
            {t.auth.poweredBy} <span className="font-semibold text-white/60">TIMS ATS</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
