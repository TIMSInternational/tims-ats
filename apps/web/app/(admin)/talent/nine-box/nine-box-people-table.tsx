'use client';

import { CandidateAvatar } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatPercent } from '../../../../lib/format-utils';
import { toPercent, type NineBoxEvaluation } from './nine-box-labels';

interface NineBoxPeopleTableProps {
  allPeople: NineBoxEvaluation[];
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
}

/** The grid's data as a table: the keyboard and screen-reader path to select a person. */
export function NineBoxPeopleTable({ allPeople, selectedUserId, onSelectUser }: NineBoxPeopleTableProps) {
  const { t, locale } = useI18n();
  return (
    <div className="mt-4 overflow-x-auto border-t border-border pt-3">
      <table className="w-full text-body" aria-label={t.nineBox.gridTableLabel}>
        <thead>
          <tr className="bg-surface text-callout text-secondary">
            <th scope="col" className="w-14 rounded-l-lg px-3 py-2 text-center font-semibold">
              {t.nineBox.colIndex}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              {t.nineBox.colName}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {t.nineBox.colPotential}
            </th>
            <th scope="col" className="rounded-r-lg px-3 py-2 text-right font-semibold">
              {t.nineBox.colPerformance}
            </th>
          </tr>
        </thead>
        <tbody>
          {allPeople.map((ev, idx) => {
            const isSelected = ev.user.id === selectedUserId;
            return (
              <tr
                key={ev.id}
                aria-current={isSelected ? 'true' : undefined}
                className={`border-b border-border ${isSelected ? 'bg-brand-tint' : 'hover:bg-surface-hover'}`}
              >
                <td className="px-3 py-2 text-center font-medium tabular-nums text-primary">{idx + 1}</td>
                <td className="px-3 py-1">
                  <button
                    type="button"
                    onClick={() => onSelectUser(ev.user.id)}
                    aria-pressed={isSelected}
                    className="flex min-h-9 w-full items-center gap-2 rounded-lg text-left text-primary hover:text-brand pointer-coarse:min-h-11"
                  >
                    <CandidateAvatar
                      firstName={ev.user.firstName}
                      lastName={ev.user.lastName}
                      avatar={ev.user.avatar}
                      size="sm"
                      decorative
                    />
                    <span className={isSelected ? 'font-semibold' : ''}>
                      {ev.user.firstName} {ev.user.lastName}
                    </span>
                    {isSelected && (
                      <svg
                        className="size-4 shrink-0 text-brand"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-primary">
                  {formatPercent(Math.round(toPercent(ev.potentialScore)), locale)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-primary">
                  {formatPercent(Math.round(toPercent(ev.performanceScore)), locale)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
