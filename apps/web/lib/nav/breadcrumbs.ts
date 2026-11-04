// Header breadcrumb resolution. Pure (no React / next imports) so node tests can exercise it.
//
// The i18n `breadcrumbs` map is keyed by route path. An exact match wins; otherwise the LONGEST key that
// is a segment-aware prefix of the path is used, so detail pages (/recruitment/vacancies/[id],
// /recruitment/interviews/[id]/room) inherit their list page's crumb and section keys (/settings,
// /platform …) catch anything newer. No match → null, and the header shows no crumb rather than a
// product name that says nothing about where the user is.

export type Crumb = { readonly parent?: string; readonly label: string };

export function resolveBreadcrumb(pathname: string, crumbs: Readonly<Record<string, Crumb>>): Crumb | null {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(crumbs, key);
  if (has(pathname)) return crumbs[pathname] ?? null;
  let best: string | undefined;
  for (const key of Object.keys(crumbs)) {
    if (pathname.startsWith(`${key}/`) && (best === undefined || key.length > best.length)) best = key;
  }
  return best === undefined ? null : (crumbs[best] ?? null);
}
