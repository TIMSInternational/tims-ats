'use client';

import { StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { QUADRANT_TONE } from './nine-box-labels';

const PLAN_QUADRANTS = ['star', 'high_potential', 'solid_performer', 'core_player', 'enigma', 'risk'] as const;

/** The standard development plan suggested for each quadrant. */
export function AutoPlanCard() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="nine-box-plans" className="rounded-xl border border-border bg-white p-4 shadow-card">
      <h2 id="nine-box-plans" className="mb-2 text-heading font-semibold text-brand">
        {t.nineBox.autoPlanTitle}
      </h2>
      <dl className="space-y-2">
        {PLAN_QUADRANTS.map((q) => (
          <div key={q} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
            <dt className="w-36 shrink-0">
              <StatusBadge tone={QUADRANT_TONE[q]}>{t.nineBox.quadrants[q]}</StatusBadge>
            </dt>
            <dd className="text-callout text-secondary">{t.nineBox.autoPlans[q]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
