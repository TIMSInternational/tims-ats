// RH-10: the public careers URL of a vacancy — /careers/<orgSlug>/<vacancyId>, the route served by
// app/(portal)/careers/[orgSlug]/[vacancyId]. The origin is the configured NEXT_PUBLIC_APP_URL when
// set (so a link copied on a preview/alias host still points at the canonical app), else the
// browser's own origin.
export function buildPublicVacancyUrl(origin: string, orgSlug: string, vacancyId: string): string {
  const base = origin.trim().replace(/\/+$/, '');
  return `${base}/careers/${encodeURIComponent(orgSlug)}/${encodeURIComponent(vacancyId)}`;
}

export function resolvePublicOrigin(
  configured: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
  browserOrigin: string | undefined = typeof window !== 'undefined' ? window.location.origin : undefined,
): string {
  const value = configured?.trim();
  return value ? value : (browserOrigin ?? '');
}
