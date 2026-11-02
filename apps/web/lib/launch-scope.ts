// Launch scope (pilot). A single deploy-time switch that narrows the product surface to what a closed
// pilot actually uses: recruitment v1 (vacancy → apply → pipeline → interviews → offers → hire), basic
// onboarding, team/people admin and the settings those need.
//
// NEXT_PUBLIC_LAUNCH_SCOPE=pilot  → out-of-scope modules are hidden from EVERY role (privileged
//                                    included) in the tenant + platform sidebars, direct navigation to
//                                    them shows AccessDenied, and the candidate portal drops the
//                                    assessments / AI FAQ / marketing blocks.
// unset (or any other value)       → full product, behaviour unchanged.
//
// Pure module (no React / next imports) so node tests can exercise it. UX only — the API remains the
// enforcement boundary for anything a hidden page would call.

export type LaunchScope = 'full' | 'pilot';

/** Resolve the launch scope. `process.env.NEXT_PUBLIC_LAUNCH_SCOPE` must stay a literal reference so
 *  Next inlines it into the client bundle. Only the exact string 'pilot' narrows the scope. */
export function readLaunchScope(raw: string | undefined = process.env.NEXT_PUBLIC_LAUNCH_SCOPE): LaunchScope {
  return raw?.trim() === 'pilot' ? 'pilot' : 'full';
}

export function isPilotScope(scope: LaunchScope = readLaunchScope()): boolean {
  return scope === 'pilot';
}

/** Route prefixes that are out of scope for the pilot. Segment-aware prefix match (see
 *  isHrefHiddenInScope): '/talent' hides '/talent/360' but not '/talentos'. */
export const LAUNCH_HIDDEN_HREFS: readonly string[] = [
  // Recruitment extras outside v1
  '/recruitment/assessments',
  '/recruitment/analytics',
  // Performance / learning / 360
  '/people/performance',
  '/learning',
  '/my-360',
  '/talent',
  // Culture / DEI / compensation / monitoring (HR suite)
  '/engagement',
  '/compensation',
  '/monitoring',
  // Stripe self-serve billing / dunning + API keys / integrations
  '/settings/billing',
  '/settings/integrations',
  // Platform-owner surfaces not used in the pilot
  '/platform/feature-flags',
];

/** True when `pathname` is (or is nested under) a hidden href and the scope is the pilot. */
export function isHrefHiddenInScope(pathname: string, scope: LaunchScope = readLaunchScope()): boolean {
  if (scope !== 'pilot') return false;
  return LAUNCH_HIDDEN_HREFS.some((h) => pathname === h || pathname.startsWith(`${h}/`));
}

/** Drop hidden items from nav sections (and sections left empty). Shape-generic so it serves both the
 *  manifest-driven tenant sidebars and the platform sidebar's own section list. */
export function filterSectionsForScope<I extends { readonly href: string }, S extends { readonly items: readonly I[] }>(
  sections: readonly S[],
  scope: LaunchScope = readLaunchScope(),
): S[] {
  if (scope !== 'pilot') return [...sections];
  return sections
    .map((s) => ({ ...s, items: s.items.filter((it) => !isHrefHiddenInScope(it.href, scope)) }))
    .filter((s) => s.items.length > 0);
}
