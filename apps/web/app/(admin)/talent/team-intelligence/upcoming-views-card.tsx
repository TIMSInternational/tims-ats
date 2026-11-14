'use client';

import { useI18n } from '../../../../lib/i18n';
import { PcaProfile } from './pca-profile';
import { TeamComposition } from './team-composition';
import { BalanceAlerts } from './balance-alerts';
import { RecommendedHires } from './recommended-hires';
import { TeamComparison } from './team-comparison';

/** The five views that are not built yet, grouped in one card instead of five full-size placeholders. */
export function UpcomingViewsCard() {
  const { t } = useI18n();
  return (
    <section
      aria-labelledby="team-intel-upcoming"
      className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5"
    >
      <h2 id="team-intel-upcoming" className="text-heading font-semibold text-brand">
        {t.teamIntel.comingSoonTitle}
      </h2>
      <p className="mb-3 mt-0.5 text-callout text-secondary">{t.teamIntel.comingSoonDesc}</p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PcaProfile t={t.teamIntel} />
        <TeamComposition t={t.teamIntel} />
        <BalanceAlerts t={t.teamIntel} />
        <RecommendedHires t={t.teamIntel} />
        <TeamComparison t={t.teamIntel} />
      </ul>
    </section>
  );
}
