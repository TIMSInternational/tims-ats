import { redirect } from 'next/navigation';

// Legacy entry point. The candidate dashboard moved from /me to /dashboard
// (2026-07-30) — the candidate portal is live to real candidates
// (docs/REMAINING-WORK.md marks it REAL), so this long-lived redirect protects
// any already-sent magic-link email or saved bookmark that still points at
// the old path. Preserves the query string so nothing is silently dropped.
export default async function LegacyMeRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgSlug } = await params;
  const qs = new URLSearchParams((await searchParams) as Record<string, string>).toString();
  redirect(`/careers/${orgSlug}/dashboard${qs ? `?${qs}` : ''}`);
}
