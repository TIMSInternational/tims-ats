'use client';

import { useI18n } from '../../../../lib/i18n';
import { inputClasses, selectClasses } from '../../../../components';
import { COMPETENCY_DESCRIPTION_MAX, COMPETENCY_NAME_MAX, type CompetencyDraft } from './competencies-model';

interface CompetencyRowProps {
  draft: CompetencyDraft;
  index: number;
  total: number;
  /** The row's name is empty or repeats another row's. */
  invalid: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onChange: (next: CompetencyDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

const fieldCls = inputClasses('md');
const iconBtnCls =
  'flex size-8 items-center justify-center rounded-lg border border-field-border text-secondary transition-colors hover:bg-surface disabled:opacity-40 pointer-coarse:size-11';

/** One editable competency: name, short description, expected level, reorder and remove. */
export function CompetencyRow({
  draft,
  index,
  total,
  invalid,
  autoFocus,
  disabled,
  onChange,
  onMove,
  onRemove,
}: CompetencyRowProps) {
  const { t } = useI18n();
  const v = t.vacancies;
  const display = draft.name.trim() || v.competencyUnnamed;
  const levels = Array.from({ length: draft.scaleMax }, (_, i) => i + 1);

  return (
    <li className="space-y-2 rounded-lg border border-border bg-white p-2.5" data-testid="competency-row">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder={v.competencyNamePlaceholder}
          aria-label={v.competencyNameLabel}
          aria-invalid={invalid}
          maxLength={COMPETENCY_NAME_MAX}
          readOnly={draft.code !== null}
          disabled={disabled}
          autoFocus={autoFocus}
          className={`${fieldCls} flex-1 ${invalid ? 'border-danger' : ''} ${draft.code !== null ? 'bg-surface-hover' : ''}`}
        />
        {draft.code !== null && (
          <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-caption font-medium text-brand">
            {v.competencyCatalogBadge}
          </span>
        )}
        <select
          value={draft.level}
          onChange={(e) => onChange({ ...draft, level: Number(e.target.value) })}
          aria-label={`${v.competencyLevelLabel}: ${display}`}
          disabled={disabled}
          className={`${selectClasses('md')} w-24 shrink-0`}
        >
          {levels.map((n) => (
            <option key={n} value={n}>
              {v.competencyLevelOption.replace('{n}', String(n)).replace('{max}', String(draft.scaleMax))}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          placeholder={v.competencyDescriptionPlaceholder}
          aria-label={v.competencyDescriptionLabel}
          maxLength={COMPETENCY_DESCRIPTION_MAX}
          disabled={disabled}
          className={`${fieldCls} flex-1`}
        />
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={disabled || index === 0}
          aria-label={v.competencyMoveUp.replace('{name}', display)}
          className={iconBtnCls}
        >
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={disabled || index === total - 1}
          aria-label={v.competencyMoveDown.replace('{name}', display)}
          className={iconBtnCls}
        >
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={v.competencyRemove.replace('{name}', display)}
          className={iconBtnCls}
        >
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </li>
  );
}
