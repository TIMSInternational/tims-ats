import {
  BUILTIN_COMPETENCY_IDS,
  COMPETENCY_DESCRIPTION_MAX,
  COMPETENCY_NAME_MAX,
  DEFAULT_COMPETENCY_SCALE_MAX,
  MAX_COMPETENCIES,
  builtinCompetencyCode,
  competencyNameKey,
  parseProfileCompetencies,
  type CompetencyCatalog,
  type CompetencyCatalogEntry,
  type JobProfileCompetencyInput,
} from '@tims/shared';

// ---------------------------------------------------------------------------
// Pure editing model for "Competencias del puesto" (vacancy wizard step 2 and the "Editar" drawer).
// The stored shape and its validation live in @tims/shared (job-profile.ts); this only turns editor rows
// into that input and back. React-free so the rules are unit-testable on their own.
// ---------------------------------------------------------------------------

export { COMPETENCY_DESCRIPTION_MAX, COMPETENCY_NAME_MAX, MAX_COMPETENCIES };

export interface CompetencyDraft {
  /** Client-only row identity (React key, focus); never sent. */
  rowId: string;
  /** Catalog reference, or null for a custom competency. */
  code: string | null;
  name: string;
  description: string;
  level: number;
  scaleMax: number;
}

/** A competency the AI proposed (vacancy-writer / "Sugerir competencias"), always on the 1-5 scale. */
export interface CompetencySuggestion {
  name: string;
  description: string;
  level: number;
}

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `competency-${rowSeq}`;
}

/** The level a new row starts at: the middle of its scale ("competente" on 1-5). */
export function defaultLevel(scaleMax: number): number {
  return Math.ceil(scaleMax / 2);
}

export function customDraft(): CompetencyDraft {
  const scaleMax = DEFAULT_COMPETENCY_SCALE_MAX;
  return { rowId: nextRowId(), code: null, name: '', description: '', level: defaultLevel(scaleMax), scaleMax };
}

export function draftFromCatalog(entry: CompetencyCatalogEntry): CompetencyDraft {
  return {
    rowId: nextRowId(),
    code: entry.code,
    name: entry.name,
    description: entry.description ?? '',
    level: defaultLevel(entry.scaleMax),
    scaleMax: entry.scaleMax,
  };
}

export function draftFromSuggestion(s: CompetencySuggestion): CompetencyDraft {
  const scaleMax = DEFAULT_COMPETENCY_SCALE_MAX;
  return {
    rowId: nextRowId(),
    code: null,
    name: s.name.slice(0, COMPETENCY_NAME_MAX),
    description: s.description.slice(0, COMPETENCY_DESCRIPTION_MAX),
    level: Math.min(Math.max(1, Math.round(s.level)), scaleMax),
    scaleMax,
  };
}

/** Editor rows for a stored job profile (vacancy detail → "Editar"); same parser as the scorecard. */
export function draftsFromStored(raw: unknown): CompetencyDraft[] {
  return parseProfileCompetencies(raw).map((c) => ({
    rowId: nextRowId(),
    code: c.code,
    name: c.name,
    description: c.description ?? '',
    level: c.level ?? defaultLevel(c.scaleMax),
    scaleMax: c.scaleMax,
  }));
}

/** The writer input for vacancy.create / vacancy.update (validated again server-side). */
export function toCompetencyInput(drafts: readonly CompetencyDraft[]): JobProfileCompetencyInput[] {
  return drafts.map((d) => {
    const description = d.description.trim();
    return {
      name: d.name.trim(),
      level: d.level,
      scaleMax: d.scaleMax,
      ...(d.code ? { code: d.code } : {}),
      ...(description ? { description } : {}),
    };
  });
}

export type CompetencyDraftError = 'nameRequired' | 'duplicate' | 'tooMany';

/** Why the rows cannot be saved yet, or null. No rows at all is valid (the scorecard uses its generic set). */
export function validateCompetencyDrafts(drafts: readonly CompetencyDraft[]): CompetencyDraftError | null {
  if (drafts.length > MAX_COMPETENCIES) return 'tooMany';
  if (drafts.some((d) => d.name.trim() === '')) return 'nameRequired';
  const names = new Set<string>();
  for (const d of drafts) {
    const key = competencyNameKey(d.name);
    if (names.has(key)) return 'duplicate';
    names.add(key);
  }
  return null;
}

/** Row ids whose name repeats an earlier row's (to point at the offending rows). */
export function duplicateRowIds(drafts: readonly CompetencyDraft[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const d of drafts) {
    const key = competencyNameKey(d.name);
    if (!key) continue;
    if (seen.has(key)) dupes.add(d.rowId);
    seen.add(key);
  }
  return dupes;
}

/** Did the editor change what is stored (order included)? Compares the would-be input, not row ids. */
export function competenciesChanged(initial: readonly CompetencyDraft[], current: readonly CompetencyDraft[]): boolean {
  return JSON.stringify(toCompetencyInput(initial)) !== JSON.stringify(toCompetencyInput(current));
}

export function moveDraft(drafts: readonly CompetencyDraft[], rowId: string, delta: -1 | 1): CompetencyDraft[] {
  const from = drafts.findIndex((d) => d.rowId === rowId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= drafts.length) return [...drafts];
  const next = [...drafts];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Suggestions not already in the list (by name), so accepting one never creates a duplicate. */
export function pendingSuggestions(
  suggestions: readonly CompetencySuggestion[],
  drafts: readonly CompetencyDraft[],
): CompetencySuggestion[] {
  const taken = new Set(drafts.map((d) => competencyNameKey(d.name)));
  return suggestions.filter((s) => !taken.has(competencyNameKey(s.name)));
}

/** Catalog entries not already picked (by code or by name). */
export function availableCatalogEntries(
  catalog: CompetencyCatalog,
  drafts: readonly CompetencyDraft[],
): CompetencyCatalogEntry[] {
  const codes = new Set(drafts.map((d) => d.code).filter((c): c is string => c !== null));
  const names = new Set(drafts.map((d) => competencyNameKey(d.name)));
  return catalog.entries.filter((e) => !codes.has(e.code) && !names.has(competencyNameKey(e.name)));
}

export type BuiltinCatalogLabels = Record<string, { name: string; description: string } | undefined>;

/**
 * The built-in catalog: the product's generic competencies with this locale's labels. It is the only
 * catalog in this codebase; an organization's own (or a licensed) catalog would be another
 * CompetencyCatalog fetched at runtime and listed beside it, under its own code namespace.
 */
export function builtinCompetencyCatalog(labels: BuiltinCatalogLabels): CompetencyCatalog {
  return {
    id: 'builtin',
    entries: BUILTIN_COMPETENCY_IDS.flatMap((id) => {
      const label = labels[id];
      return label
        ? [
            {
              code: builtinCompetencyCode(id),
              name: label.name,
              description: label.description,
              scaleMax: DEFAULT_COMPETENCY_SCALE_MAX,
            },
          ]
        : [];
    }),
  };
}
