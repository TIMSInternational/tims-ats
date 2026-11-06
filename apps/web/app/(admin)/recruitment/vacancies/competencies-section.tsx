'use client';

import { useMemo, useState } from 'react';
import { RECOMMENDED_COMPETENCY_COUNT } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { CompetencyRow } from './competency-row';
import { CompetencySuggestions } from './competency-suggestions';
import {
  MAX_COMPETENCIES,
  availableCatalogEntries,
  builtinCompetencyCatalog,
  customDraft,
  draftFromCatalog,
  draftFromSuggestion,
  duplicateRowIds,
  moveDraft,
  pendingSuggestions,
  validateCompetencyDrafts,
  type CompetencyDraft,
  type CompetencySuggestion,
} from './competencies-model';

/** Upper bound on the description text "Sugerir competencias" sends (the procedure's input bound). */
const SUGGEST_DESCRIPTION_MAX = 5000;

interface CompetenciesSectionProps {
  value: CompetencyDraft[];
  onChange: (next: CompetencyDraft[]) => void;
  /** AI suggestions awaiting review ("Generar con IA" or "Sugerir competencias"). */
  suggestions: CompetencySuggestion[];
  onSuggestionsChange: (next: CompetencySuggestion[]) => void;
  /** What "Sugerir competencias" works from. */
  title: string;
  descriptionText: string;
  /** vacancy.generateDescription needs vacancy:create; hide the action without it. */
  canSuggest?: boolean;
  disabled?: boolean;
}

/**
 * "Competencias del puesto": the job profile the interview scorecard rates and the AI interview guide asks
 * about. Optional (3-10 recommended): without any, the scorecard keeps its generic set.
 */
export function CompetenciesSection({
  value,
  onChange,
  suggestions,
  onSuggestionsChange,
  title,
  descriptionText,
  canSuggest = true,
  disabled,
}: CompetenciesSectionProps) {
  const { t } = useI18n();
  const v = t.vacancies;
  const [focusRowId, setFocusRowId] = useState<string | null>(null);

  const catalog = useMemo(() => builtinCompetencyCatalog(v.competencyCatalog), [v.competencyCatalog]);
  const available = availableCatalogEntries(catalog, value);
  const pending = pendingSuggestions(suggestions, value);
  const room = MAX_COMPETENCIES - value.length;
  const error = validateCompetencyDrafts(value);
  const dupes = duplicateRowIds(value);

  const suggest = trpc.vacancy.generateDescription.useMutation({
    onSuccess: (data) => {
      if (data.kind === 'competencies') onSuggestionsChange(data.competencies);
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });
  const canRunSuggest = title.trim().length > 0;

  const add = (draft: CompetencyDraft) => {
    if (room <= 0) return;
    onChange([...value, draft]);
    setFocusRowId(draft.rowId);
  };
  const addSuggestions = (items: CompetencySuggestion[]) => {
    const accepted = items.slice(0, Math.max(0, room)).map(draftFromSuggestion);
    if (accepted.length > 0) onChange([...value, ...accepted]);
  };

  const errorText =
    error === 'nameRequired'
      ? v.competencyErrorName
      : error === 'duplicate'
        ? v.competencyErrorDuplicate
        : error === 'tooMany'
          ? v.competencyErrorTooMany.replace('{max}', String(MAX_COMPETENCIES))
          : null;
  const outsideRecommended =
    value.length > 0 &&
    (value.length < RECOMMENDED_COMPETENCY_COUNT.min || value.length > RECOMMENDED_COMPETENCY_COUNT.max);

  return (
    <section aria-labelledby="vacancy-competencies-title" className="rounded-lg border border-[#EDEDED] p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="vacancy-competencies-title" className="text-[12px] font-medium text-[#1F114C]">
            {v.competenciesSectionTitle}
          </p>
          <p className="text-[10px] text-[#8B8B8B]">{v.competenciesSectionHelp}</p>
        </div>
        {canSuggest && (
          <button
            type="button"
            onClick={() =>
              suggest.mutate({
                title: title.trim(),
                mode: 'competencies',
                description: descriptionText.trim().slice(0, SUGGEST_DESCRIPTION_MAX) || undefined,
              })
            }
            disabled={disabled || !canRunSuggest || suggest.isPending}
            className="h-8 px-3 rounded-lg border border-[#1F114C] text-[#1F114C] text-[11px] font-medium hover:bg-[#1F114C]/5 transition disabled:opacity-50 flex items-center gap-1.5 shrink-0"
          >
            {suggest.isPending && (
              <span className="w-3 h-3 border-2 border-[#1F114C]/30 border-t-[#1F114C] rounded-full animate-spin" />
            )}
            {suggest.isPending ? v.competencySuggesting : v.competencySuggestAction}
          </button>
        )}
      </div>
      {canSuggest && !canRunSuggest && <p className="text-[10px] text-[#8B8B8B]">{v.competencySuggestNeedsTitle}</p>}

      {suggestions.length > 0 && (
        <CompetencySuggestions
          pending={pending}
          canAdd={room > 0}
          disabled={disabled}
          onAdd={(s) => addSuggestions([s])}
          onAddAll={() => addSuggestions(pending)}
          onDismiss={() => onSuggestionsChange([])}
        />
      )}

      {value.length > 0 ? (
        <ol className="space-y-2" aria-label={v.competenciesSectionTitle}>
          {value.map((draft, index) => (
            <CompetencyRow
              key={draft.rowId}
              draft={draft}
              index={index}
              total={value.length}
              invalid={draft.name.trim() === '' || dupes.has(draft.rowId)}
              autoFocus={draft.rowId === focusRowId && draft.code === null}
              disabled={disabled}
              onChange={(next) => onChange(value.map((d) => (d.rowId === draft.rowId ? next : d)))}
              onMove={(delta) => onChange(moveDraft(value, draft.rowId, delta))}
              onRemove={() => onChange(value.filter((d) => d.rowId !== draft.rowId))}
            />
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-[#8B8B8B]">{v.competenciesEmpty}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value=""
          onChange={(e) => {
            const entry = available.find((c) => c.code === e.target.value);
            if (entry) add(draftFromCatalog(entry));
          }}
          aria-label={v.competencyCatalogLabel}
          disabled={disabled || room <= 0 || available.length === 0}
          className="h-8 px-2 rounded-lg border border-[#EDEDED] bg-white text-[12px] text-[#585858] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 disabled:opacity-50"
        >
          <option value="">{v.competencyCatalogPlaceholder}</option>
          {available.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => add(customDraft())}
          disabled={disabled || room <= 0}
          className="h-8 px-3 rounded-lg border border-[#EDEDED] text-[#585858] text-[11px] font-medium hover:bg-[#F6F6F6] transition disabled:opacity-50"
        >
          {v.competencyAddCustom}
        </button>
        {value.length > 0 && (
          <span className={`ml-auto text-[10px] ${outsideRecommended ? 'text-amber-700' : 'text-[#8B8B8B]'}`}>
            {v.competenciesCount
              .replace('{n}', String(value.length))
              .replace('{min}', String(RECOMMENDED_COMPETENCY_COUNT.min))
              .replace('{max}', String(RECOMMENDED_COMPETENCY_COUNT.max))}
          </span>
        )}
      </div>
      <p className="text-[10px] text-[#8B8B8B]">{v.competencyLevelHint.replace('{max}', '5')}</p>

      {errorText && (
        <p role="alert" className="text-[11px] text-[#DD0C15]">
          {errorText}
        </p>
      )}
    </section>
  );
}
