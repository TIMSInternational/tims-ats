'use client';

import { EmptyState } from '../../../../components/empty-state';

interface BalanceAlertsProps {
  t: {
    balanceAlerts: string;
    aiPanelEmptyTitle: string;
    aiPanelEmptyBody: string;
  };
}

/** A view that is not built yet: its name and one plain line, compact (layout.md › Visual hierarchy). */
export function BalanceAlerts({ t }: BalanceAlertsProps) {
  return (
    <li className="rounded-lg border border-border p-3">
      <h3 className="text-body font-semibold text-brand">{t.balanceAlerts}</h3>
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
            <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
        }
        title={t.aiPanelEmptyTitle}
        description={t.aiPanelEmptyBody}
      />
    </li>
  );
}
