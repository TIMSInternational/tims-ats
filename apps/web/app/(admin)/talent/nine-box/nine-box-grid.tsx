'use client';

import { useId } from 'react';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { NineBoxPeopleTable } from './nine-box-people-table';
import { CELL_QUADRANT, cellFill, isQuadrantKey, toPercent, type NineBoxEvaluation } from './nine-box-labels';

interface NineBoxGridProps {
  grid: Record<string, NineBoxEvaluation[]>;
  allPeople: NineBoxEvaluation[];
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
  period: string;
}

/** The 3×3 performance × potential matrix (charts.md › Enhancing the accessibility of a chart). */
export function NineBoxGrid({ allPeople, selectedUserId, onSelectUser, period }: NineBoxGridProps) {
  const { t } = useI18n();
  const titleId = useId();
  const quadrantName = (q: string) => (isQuadrantKey(q) ? t.nineBox.quadrants[q] : q);

  // A text overview of the distribution, for people who cannot see the dots.
  const counts = new Map<string, number>();
  for (const ev of allPeople) counts.set(quadrantName(ev.quadrant), (counts.get(quadrantName(ev.quadrant)) ?? 0) + 1);
  const summary = formatMessage(t.nineBox.summary, {
    total: allPeople.length,
    breakdown: Array.from(counts.entries())
      .map(([quadrant, count]) => formatMessage(t.nineBox.summaryItem, { count, quadrant }))
      .join(', '),
  });

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-border bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-heading font-semibold text-brand">
          {t.nineBox.predictiveTitleTims}
        </h2>
        <span className="text-callout text-secondary">{formatMessage(t.nineBox.cycleLabel, { period })}</span>
      </div>

      <div
        role="group"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-summary`}
        className="flex w-full max-w-[360px] mx-auto"
      >
        <p id={`${titleId}-summary`} className="sr-only">
          {summary}
        </p>
        {/* Y axis */}
        <div className="mr-1 flex items-center justify-center rotate-180 [writing-mode:vertical-rl]" aria-hidden="true">
          <span className="text-callout font-semibold text-secondary">{t.nineBox.axisPotential}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative aspect-square w-full border-b-2 border-l-2 border-secondary">
            <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-0.5 p-0.5">
              {[3, 2, 1].map((pot) =>
                [1, 2, 3].map((perf) => {
                  const key = `${pot}-${perf}`;
                  return (
                    <div key={key} className={`rounded-lg p-1.5 ${cellFill(pot, perf)}`}>
                      <span className="text-caption font-medium leading-tight text-primary">
                        {t.nineBox.quadrants[CELL_QUADRANT[key]]}
                      </span>
                    </div>
                  );
                }),
              )}
            </div>

            {/* One dot per person; the number matches the table row below. */}
            {allPeople.map((ev, idx) => {
              const potential = Math.round(toPercent(ev.potentialScore));
              const performance = Math.round(toPercent(ev.performanceScore));
              const isSelected = ev.user.id === selectedUserId;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onSelectUser(ev.user.id)}
                  aria-pressed={isSelected}
                  aria-label={formatMessage(t.nineBox.dotLabel, {
                    name: `${ev.user.firstName} ${ev.user.lastName}`,
                    quadrant: quadrantName(ev.quadrant),
                    potential,
                    performance,
                  })}
                  className={`absolute z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-brand text-caption font-semibold shadow-card before:absolute before:-inset-2 before:content-[''] pointer-coarse:before:-inset-2 ${
                    isSelected ? 'bg-brand text-white ring-2 ring-brand ring-offset-2' : 'bg-white text-brand'
                  }`}
                  style={{ left: `${toPercent(ev.performanceScore)}%`, top: `${100 - toPercent(ev.potentialScore)}%` }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-callout font-semibold text-secondary" aria-hidden="true">
            {t.nineBox.axisPerformance}
          </p>
        </div>
      </div>

      <NineBoxPeopleTable allPeople={allPeople} selectedUserId={selectedUserId} onSelectUser={onSelectUser} />
    </section>
  );
}
