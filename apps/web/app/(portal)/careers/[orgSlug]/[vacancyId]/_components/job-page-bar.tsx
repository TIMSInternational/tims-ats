import Link from 'next/link';
import { OrgLogo } from '../../../../../../components/org-logo';
import { useI18n } from '../../../../../../lib/i18n';
import { usePortalOrgBrand } from '../../_components/portal-org-brand';

interface JobPageBarProps {
  orgSlug: string;
  /**
   * From the vacancy once it loads. While it loads, and on the closed / not-found / error states, the bar
   * falls back to the organization the careers layout already read by slug, so every state carries it.
   */
  orgName?: string;
  orgLogo?: string | null;
}

/** The job page's top bar: the way back to the board leading, the organization trailing. */
export function JobPageBar({ orgSlug, orgName: vacancyOrgName, orgLogo: vacancyOrgLogo = null }: JobPageBarProps) {
  const { t } = useI18n();
  const layoutBrand = usePortalOrgBrand();
  const orgName = vacancyOrgName ?? layoutBrand?.name;
  const orgLogo = vacancyOrgName ? vacancyOrgLogo : (layoutBrand?.logo ?? null);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white px-4 sm:px-6">
      <Link
        href={`/careers/${orgSlug}`}
        className="inline-flex min-h-7 shrink-0 items-center gap-1.5 text-body font-medium text-secondary hover:text-brand pointer-coarse:min-h-11"
      >
        <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t.portal.backToVacancies}
      </Link>
      {orgName && (
        <span className="ml-auto flex min-w-0 items-center gap-2">
          <OrgLogo
            logo={orgLogo}
            name={orgName}
            imgClassName="h-7 w-auto max-w-[120px] shrink-0 object-contain"
            fallbackClassName="hidden"
            decorative
          />
          <span className="truncate text-body font-bold tracking-tight text-brand">{orgName}</span>
        </span>
      )}
    </header>
  );
}
