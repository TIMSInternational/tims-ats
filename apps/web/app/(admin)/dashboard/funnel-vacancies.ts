/**
 * The dashboard funnel's vacancy options: open (published) vacancies first, then recently filled ones,
 * tagged. A confirmed hire closes the vacancy once every position is covered, which is exactly when its
 * terminal "Contratado" bar is worth seeing, so closed vacancies must stay selectable.
 */
export function buildFunnelVacancies<T extends { title: string }>(published: T[], closed: T[], closedTag: string): T[] {
  return [...published, ...closed.map((vacancy) => ({ ...vacancy, title: `${vacancy.title} · ${closedTag}` }))];
}
