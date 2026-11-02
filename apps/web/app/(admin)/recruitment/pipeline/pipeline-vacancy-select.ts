// RH-11: the pipeline honours `?vacancy=<id>` (linked from the vacancy detail page and the
// candidates summary). The page only lists the first 50 published vacancies, so a requested id
// outside that list (an older vacancy, or an approved-but-unpublished one opened from its detail
// page) is looked up on its own. Only when that lookup fails does the page fall back to the first
// vacancy, and then it says so instead of silently opening a different one.

export interface PipelineVacancyOption {
  id: string;
  title: string;
  company?: { name: string } | null;
}

export type RequestedVacancyLookup =
  | { status: 'loading' }
  | { status: 'found'; vacancy: PipelineVacancyOption }
  | { status: 'unavailable' };

export interface InitialVacancyDecision {
  id: string | null;
  /** True when a requested vacancy could not be opened and another one is shown instead. */
  notice: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVacancyIdShape(id: string): boolean {
  return UUID_RE.test(id);
}

/** Returns null while the decision still depends on a pending lookup (or an empty list). */
export function resolveInitialVacancy(
  vacancies: ReadonlyArray<{ id: string }>,
  requestedId: string | null | undefined,
  lookup: RequestedVacancyLookup,
): InitialVacancyDecision | null {
  if (requestedId) {
    if (vacancies.some((v) => v.id === requestedId)) return { id: requestedId, notice: false };
    if (lookup.status === 'loading') return null;
    if (lookup.status === 'found') return { id: lookup.vacancy.id, notice: false };
    return { id: vacancies[0]?.id ?? null, notice: true };
  }
  const first = vacancies[0]?.id;
  return first ? { id: first, notice: false } : null;
}
