'use client';

import { useI18n } from '../../../../lib/i18n';
import type { CompetencySuggestion } from './competencies-model';

interface CompetencySuggestionsProps {
  /** Suggestions not yet in the list. */
  pending: CompetencySuggestion[];
  /** False once the list is full: nothing more can be added. */
  canAdd: boolean;
  disabled?: boolean;
  onAdd: (s: CompetencySuggestion) => void;
  onAddAll: () => void;
  onDismiss: () => void;
}

/**
 * The AI's proposed competencies, shown for the recruiter to accept one by one or all at once —
 * never applied on their own. Accepted ones become ordinary editable rows.
 */
export function CompetencySuggestions({
  pending,
  canAdd,
  disabled,
  onAdd,
  onAddAll,
  onDismiss,
}: CompetencySuggestionsProps) {
  const { t } = useI18n();
  const v = t.vacancies;

  return (
    <div
      className="rounded-lg border border-dashed border-[#5C4B99]/40 bg-[#5C4B99]/5 p-2.5 space-y-2"
      role="region"
      aria-label={v.competencySuggestionsTitle}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-medium text-[#1F114C]">{v.competencySuggestionsTitle}</p>
          <p className="text-[10px] text-[#8B8B8B]">
            {pending.length > 0 ? v.competencySuggestionsHelp : v.competencySuggestionsNone}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pending.length > 1 && (
            <button
              type="button"
              onClick={onAddAll}
              disabled={disabled || !canAdd}
              className="h-7 px-2.5 rounded-lg bg-[#1F114C] text-white text-[11px] font-medium hover:bg-[#2a1a5c] transition disabled:opacity-50"
            >
              {v.competencySuggestionAddAll}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            disabled={disabled}
            className="h-7 px-2.5 rounded-lg border border-[#EDEDED] bg-white text-[#585858] text-[11px] font-medium hover:bg-[#F6F6F6] transition disabled:opacity-50"
          >
            {v.competencySuggestionsDismiss}
          </button>
        </div>
      </div>
      {pending.length > 0 && (
        <ul className="space-y-1.5">
          {pending.map((s) => (
            <li
              key={s.name}
              className="flex items-start justify-between gap-2 rounded-lg bg-white border border-[#EDEDED] px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#333] break-words">
                  {s.name}{' '}
                  <span className="text-[10px] font-normal text-[#8B8B8B]">
                    {v.competencyLevelBadge.replace('{n}', String(s.level)).replace('{max}', '5')}
                  </span>
                </p>
                {s.description && <p className="text-[11px] text-[#585858] break-words">{s.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => onAdd(s)}
                disabled={disabled || !canAdd}
                aria-label={v.competencySuggestionAddNamed.replace('{name}', s.name)}
                className="h-7 px-2.5 rounded-lg border border-[#1F114C] text-[#1F114C] text-[11px] font-medium hover:bg-[#1F114C]/5 transition shrink-0 disabled:opacity-50"
              >
                {v.competencySuggestionAdd}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
