// Route → module map. Single source of truth shared by the shell RouteAccessGuard,
// the sidebar manifest, and tests. Prefix match, LONGEST-FIRST. `null` = always
// allowed. UX only — the tRPC API is the real enforcement boundary.
export const PATH_MODULE: Record<string, string | null> = {
  '/dashboard': null,
  '/recruitment/pipeline': 'pipeline',
  '/recruitment/vacancies': 'vacancy',
  '/recruitment/candidates': 'candidate',
  '/recruitment/interviews': 'interview',
  '/recruitment/assessments': 'assessment',
  '/recruitment/offers': 'offer',
  '/recruitment/talent-pools': 'candidate',
  '/recruitment/analytics': 'vacancy',
  '/people/onboarding': 'onboarding',
  '/people/performance': 'performance',
  '/learning': 'learning',
  '/talent/nine-box': 'ninebox',
  '/talent/succession': 'succession',
  '/talent/team-intelligence': 'team_intel',
  '/engagement/climate': 'engagement',
  '/engagement/dei': 'dei',
  '/compensation': 'compensation',
  '/monitoring': 'monitoring',
  '/settings/billing': 'billing',
  '/settings/integrations': 'integration',
  '/settings/business-units': 'user',
  '/settings': null,
  '/platform': null, // server-gated in its own layout
  '/mfa': null,
  '/profile': null,
};

// Longest-prefix match against PATH_MODULE. Returns the module (or null) for a
// pathname, or undefined when no entry matches (→ treated as allowed).
export function moduleForPath(pathname: string): string | null | undefined {
  let best: { key: string; module: string | null } | undefined;
  for (const [key, module] of Object.entries(PATH_MODULE)) {
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, module };
    }
  }
  return best?.module;
}
