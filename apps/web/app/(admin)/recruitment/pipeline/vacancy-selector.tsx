'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { useDismissable } from '../../../../lib/use-dismissable';
import { inputClasses, Skeleton } from '../../../../components';
import type { PipelineVacancyOption } from './pipeline-vacancy-select';

interface VacancySelectorProps {
  vacancies: PipelineVacancyOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}

/** Above this many vacancies the panel gets a search field (pop-up-buttons.md: long lists need a way in). */
const SEARCH_THRESHOLD = 8;

function Briefcase({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a4 4 0 00-8 0v2" />
    </svg>
  );
}

/**
 * The board's vacancy pop-up: a labelled trigger ("Vacante · Contador") and a listbox with the selected row
 * checked. Arrow keys move, Enter picks, Escape closes and returns focus to the trigger.
 */
export function VacancySelector({ vacancies, selectedId, onSelect, isLoading }: VacancySelectorProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = `vacancies-${useId()}`;
  const labelId = `${listId}-label`;

  useDismissable(open, wrapRef, () => setOpen(false), triggerRef);

  const selected = vacancies.find((v) => v.id === selectedId);
  const searchable = vacancies.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? vacancies.filter((v) => `${v.title} ${v.company?.name ?? ''}`.toLowerCase().includes(needle))
    : vacancies;

  const options = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);

  // On open, focus the search field, else the selected option (or the first one).
  useEffect(() => {
    if (!open) return;
    if (searchRef.current) {
      searchRef.current.focus();
      return;
    }
    const list = options();
    (list.find((el) => el.getAttribute('aria-selected') === 'true') ?? list[0])?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const pick = (id: string) => {
    onSelect(id);
    close();
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const list = options();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      if (to < 0 && searchRef.current) searchRef.current.focus();
      else list[Math.max(0, Math.min(list.length - 1, to))]?.focus();
    };
    if (event.key === 'Tab') setOpen(false);
    else if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (index === -1)
      return; // in the search field, Home/End move the text cursor
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
  };

  if (isLoading) return <Skeleton className="h-9 w-56 rounded-lg" />;

  return (
    <div ref={wrapRef} className="relative min-w-0 max-w-full">
      <span id={labelId} className="sr-only">
        {p.vacancyLabel}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${listId}-value`}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 w-full max-w-full items-center gap-2 rounded-lg border border-field-border bg-white px-3 text-left transition-colors hover:bg-surface pointer-coarse:min-h-11 md:w-auto"
      >
        <Briefcase className="size-4 shrink-0 text-brand" />
        <span aria-hidden="true" className="hidden shrink-0 text-caption text-muted sm:inline">
          {p.vacancyLabel}
        </span>
        <span id={`${listId}-value`} className="min-w-0 flex-1 truncate text-body font-medium text-brand md:max-w-64 md:flex-none">
          {selected ? selected.title : p.selectVacancy}
        </span>
        <svg
          className={`size-4 shrink-0 text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div
          onKeyDown={onListKeyDown}
          className="tims-surface absolute left-0 top-full z-50 mt-1 w-[min(340px,calc(100vw-2rem))] rounded-xl border border-border bg-white p-1 shadow-popover"
        >
          {searchable && (
            <div className="p-1">
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={100}
                aria-label={p.searchVacancy}
                aria-controls={listId}
                placeholder={p.searchVacancy}
                className={inputClasses('md')}
              />
            </div>
          )}
          <div ref={listRef} id={listId} role="listbox" aria-labelledby={labelId} className="max-h-80 overflow-y-auto">
            {vacancies.length === 0 || shown.length === 0 ? (
              <p className="px-3 py-3 text-callout text-secondary">
                {vacancies.length === 0 ? p.noPublishedVacancies : p.noVacancyMatches}
              </p>
            ) : (
              shown.map((v) => {
                const isSelected = v.id === selectedId;
                return (
                  <div
                    key={v.id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    onClick={() => pick(v.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(v.id);
                      }
                    }}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface ${
                      isSelected ? 'bg-brand-tint' : ''
                    }`}
                  >
                    <Briefcase className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-brand">{v.title}</p>
                      {v.company && <p className="truncate text-callout text-secondary">{v.company.name}</p>}
                    </div>
                    {isSelected && (
                      <svg
                        className="size-4 shrink-0 text-brand"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
