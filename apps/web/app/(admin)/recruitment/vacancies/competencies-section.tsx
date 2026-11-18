'use client';

import { useMemo, useState } from 'react';
import { RECOMMENDED_COMPETENCY_COUNT } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Button, selectClasses } from '../../../../components';
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
  // The catalogue entry chosen in the select; added only on "Agregar", so arrowing through the closed select
  // (which fires change per option in Firefox and Chrome on Windows) never adds competencies by accident.
  const [catalogPick, setCatalogPick] = useState('');

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
    <section aria-labelledby="vacancy-competencies-title" className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="vacancy-competencies-title" className="text-body font-semibold text-brand">
            {v.competenciesSectionTitle}
          </h3>
          <p className="text-callout text-secondary">{v.competenciesSectionHelp}</p>
        </div>
        {canSuggest && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() =>
              suggest.mutate({
                title: title.trim(),
                mode: 'competencies',
                description: descriptionText.trim().slice(0, SUGGEST_DESCRIPTION_MAX) || undefined,
              })
            }
            disabled={disabled || !canRunSuggest}
            loading={suggest.isPending}
            loadingLabel={v.competencySuggesting}
          >
            {v.competencySuggestAction}
          </Button>
        )}
      </div>
      {canSuggest && !canRunSuggest && <p className="text-callout text-secondary">{v.competencySuggestNeedsTitle}</p>}

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
        <p className="text-callout text-secondary">{v.competenciesEmpty}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={available.some((c) => c.code === catalogPick) ? catalogPick : ''}
          onChange={(e) => setCatalogPick(e.target.value)}
          aria-label={v.competencyCatalogLabel}
          disabled={disabled || room <= 0 || available.length === 0}
          className={selectClasses('md', 'w-auto max-w-full')}
        >
          <option value="">{v.competencyCatalogPlaceholder}</option>
          {available.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={() => {
            const entry = available.find((c) => c.code === catalogPick);
            if (!entry) return;
            add(draftFromCatalog(entry));
            setCatalogPick('');
          }}
          disabled={disabled || room <= 0 || !available.some((c) => c.code === catalogPick)}
        >
          {v.competencyCatalogAdd}
        </Button>
        <Button variant="tertiary" onClick={() => add(customDraft())} disabled={disabled || room <= 0}>
          {v.competencyAddCustom}
        </Button>
        {value.length > 0 && (
          <span className={`ml-auto text-caption ${outsideRecommended ? 'text-warning' : 'text-secondary'}`}>
            {v.competenciesCount
              .replace('{n}', String(value.length))
              .replace('{min}', String(RECOMMENDED_COMPETENCY_COUNT.min))
              .replace('{max}', String(RECOMMENDED_COMPETENCY_COUNT.max))}
          </span>
        )}
      </div>
      <p className="text-caption text-secondary">{v.competencyLevelHint.replace('{max}', '5')}</p>

      {errorText && (
        <p role="alert" className="text-callout text-danger">
          {errorText}
        </p>
      )}
    </section>
  );
}
