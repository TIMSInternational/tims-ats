'use client';

import { EmptyState } from '../../../../components/empty-state';

interface TeamCompositionProps {
  t: {
    teamComposition: string;
    teamCompositionEmptyTitle: string;
    teamCompositionEmptyBody: string;
  };
}

/** A view that is not built yet: its name and one plain line, compact (layout.md › Visual hierarchy). */
export function TeamComposition({ t }: TeamCompositionProps) {
  return (
    <li className="rounded-lg border border-border p-3">
      <h3 className="text-body font-semibold text-brand">{t.teamComposition}</h3>
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
            <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        }
        title={t.teamCompositionEmptyTitle}
        description={t.teamCompositionEmptyBody}
      />
    </li>
  );
}
