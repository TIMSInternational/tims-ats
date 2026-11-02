// RH-11: the pipeline honours `?vacancy=<id>` (linked from the vacancy detail page and the
// candidates summary). The requested id wins only when it is in the loaded vacancy list; otherwise
// the first vacancy is selected, as before.
export function pickInitialVacancyId(
  vacancies: ReadonlyArray<{ id: string }>,
  requestedId: string | null | undefined,
): string | null {
  if (requestedId && vacancies.some((v) => v.id === requestedId)) return requestedId;
  return vacancies[0]?.id ?? null;
}
