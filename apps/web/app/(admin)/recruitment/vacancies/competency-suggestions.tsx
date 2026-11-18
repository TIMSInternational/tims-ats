'use client';

import { useI18n } from '../../../../lib/i18n';
import { buttonClasses } from '../../../../components';
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
      className="space-y-2 rounded-lg border border-dashed border-brand/30 bg-brand-tint p-2.5"
      role="region"
      aria-label={v.competencySuggestionsTitle}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-callout font-semibold text-brand">{v.competencySuggestionsTitle}</p>
          <p className="text-caption text-secondary">
            {pending.length > 0 ? v.competencySuggestionsHelp : v.competencySuggestionsNone}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pending.length > 1 && (
            <button
              type="button"
              onClick={onAddAll}
              disabled={disabled || !canAdd}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              {v.competencySuggestionAddAll}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            disabled={disabled}
            className={buttonClasses({ variant: 'tertiary', size: 'sm' })}
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
              className="flex items-start justify-between gap-2 rounded-lg border border-border bg-white px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="break-words text-callout font-medium text-primary">
                  {s.name}{' '}
                  <span className="text-caption font-normal text-secondary">
                    {v.competencyLevelBadge.replace('{n}', String(s.level)).replace('{max}', '5')}
                  </span>
                </p>
                {s.description && <p className="break-words text-callout text-secondary">{s.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => onAdd(s)}
                disabled={disabled || !canAdd}
                aria-label={v.competencySuggestionAddNamed.replace('{name}', s.name)}
                className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}
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
