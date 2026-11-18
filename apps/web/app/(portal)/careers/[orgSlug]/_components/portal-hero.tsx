'use client';

import Image from 'next/image';
import { Search, MapPin } from 'lucide-react';
import { useI18n } from '../../../../../lib/i18n';
import { formatMessage } from '../../../../../lib/i18n/format';
import { Button } from '../../../../../components/button';

interface PortalHeroProps {
  orgName: string;
  stats: { totalVacancies: number; totalLocations: number; totalDepartments: number } | undefined;
  search: string;
  location: string;
  onSearchChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onSearch: () => void;
  /** False once the board is known to be empty: a search box over nothing only invites a dead end. */
  showSearch?: boolean;
}

/** "1 vacante abierta" / "3 vacantes abiertas" — `{n}` in the label is replaced with the count. */
function countLabel(n: number, one: string, many: string): string {
  return (n === 1 ? one : many).replace('{n}', String(n));
}

export function PortalHero({
  orgName,
  stats,
  search,
  location,
  onSearchChange,
  onLocationChange,
  onSearch,
  showSearch = true,
}: PortalHeroProps) {
  const { t } = useI18n();
  const p = t.portal;
  return (
    <section className="relative flex items-center justify-center overflow-hidden sm:min-h-[420px]">
      {/* Background Image */}
      <Image
        src="/portal-hero.png"
        alt=""
        fill
        className="object-cover"
        priority
      />

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand/90 via-brand-hover/80 to-brand/85" aria-hidden="true" />

      {/* Decorative Blurs */}
      <div className="absolute -left-20 -top-20 size-72 rounded-full bg-brand-red opacity-10 blur-3xl" aria-hidden="true" />
      <div className="absolute -bottom-20 -right-20 size-72 rounded-full bg-brand-hover opacity-10 blur-3xl" aria-hidden="true" />

      {/* Content */}
      <div className="relative z-10 flex w-full flex-col items-center px-4 py-8 text-center sm:px-6 sm:py-16">
        {/* The organization is the subject of the page, so it is in the heading itself. */}
        <h1 className="mb-3 font-display text-display font-extrabold text-white sm:mb-4 sm:text-[42px] sm:leading-tight">
          {formatMessage(p.heroHeadingOrg, { org: orgName })}
        </h1>

        <p className="mb-6 max-w-[550px] text-base leading-relaxed text-white/80 sm:mb-10">
          {t.portal.heroSubtitle}
        </p>

        {/* Search Bar */}
        {showSearch && (
        <form onSubmit={(event) => { event.preventDefault(); onSearch(); }} role="search" className="flex w-full max-w-[640px] flex-col items-stretch overflow-hidden rounded-xl bg-white shadow-lg sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 px-4 py-3">
            <Search className="size-4 shrink-0 text-muted" />
            <input
              type="text"
              aria-label={t.portal.searchPlaceholder}
              maxLength={100}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t.portal.searchPlaceholder}
              className="w-full bg-transparent text-base text-primary placeholder:text-muted outline-none sm:text-subheading"
            />
          </div>

          <div className="mx-4 h-px bg-border sm:mx-0 sm:h-8 sm:w-px" aria-hidden="true" />

          <div className="flex flex-1 items-center gap-2 px-4 py-3">
            <MapPin className="size-4 shrink-0 text-muted" />
            <input
              type="text"
              aria-label={t.portal.locationPlaceholder}
              maxLength={100}
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              placeholder={t.portal.locationPlaceholder}
              className="w-full bg-transparent text-base text-primary placeholder:text-muted outline-none sm:text-subheading"
            />
          </div>

          <Button type="submit" size="lg" className="m-1.5 shrink-0">
            {t.portal.searchButton}
          </Button>
        </form>
        )}

        {/* Quick Stats — pluralized, and a zero count is not shown (e.g. no departments in use). */}
        {stats && stats.totalVacancies > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-body text-white/80 sm:mt-8">
            <span className="flex items-center gap-2">
              <span className="inline-flex size-2 rounded-full bg-green-400" aria-hidden="true" />
              {countLabel(stats.totalVacancies, p.statsVacancyOne, p.statsVacancyMany)}
            </span>
            {stats.totalLocations > 0 && (
              <span>{countLabel(stats.totalLocations, p.statsLocationOne, p.statsLocationMany)}</span>
            )}
            {stats.totalDepartments > 0 && (
              <span>{countLabel(stats.totalDepartments, p.statsDepartmentOne, p.statsDepartmentMany)}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
