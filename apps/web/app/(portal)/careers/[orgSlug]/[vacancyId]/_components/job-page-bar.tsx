import Link from 'next/link';
import { OrgLogo } from '../../../../../../components/org-logo';
import { useI18n } from '../../../../../../lib/i18n';

interface JobPageBarProps {
  orgSlug: string;
  /** Unknown while the vacancy loads, or when it does not exist. */
  orgName?: string;
  orgLogo?: string | null;
}

/** The job page's top bar: the way back to the board leading, the organization trailing. */
export function JobPageBar({ orgSlug, orgName, orgLogo = null }: JobPageBarProps) {
  const { t } = useI18n();
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
