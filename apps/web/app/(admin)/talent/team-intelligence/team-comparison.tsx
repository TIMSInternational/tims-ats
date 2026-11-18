'use client';

import { EmptyState } from '../../../../components/empty-state';

interface TeamComparisonProps {
  t: {
    teamComparison: string;
    teamComparisonEmptyTitle: string;
    teamComparisonEmptyBody: string;
  };
}

/** A view that is not built yet: its name and one plain line, compact (layout.md › Visual hierarchy). */
export function TeamComparison({ t }: TeamComparisonProps) {
  return (
    <li className="rounded-lg border border-border p-3">
      <h3 className="text-body font-semibold text-brand">{t.teamComparison}</h3>
      <EmptyState
        size="compact"
        className="items-start px-0 pb-0 text-left"
        icon={
          <svg
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
          </svg>
        }
        title={t.teamComparisonEmptyTitle}
        description={t.teamComparisonEmptyBody}
      />
    </li>
  );
}
