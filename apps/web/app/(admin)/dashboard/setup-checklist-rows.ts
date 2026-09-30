import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type SetupStatus = RouterOutputs['organization']['getSetupStatus'];
export type SetupChecklistItems = SetupStatus['items'];
export type SetupChecklistItemKey = keyof SetupChecklistItems;

export interface SetupChecklistRow {
  key: SetupChecklistItemKey;
  label: string;
  done: boolean;
  href: string | null;
}

export interface SetupChecklistLabels {
  companyStructureReady: string;
  teamInvited: string;
  brandingSet: string;
  firstVacancyPosted: string;
  firstVacancyPublished: string;
}

// Pure derivation, kept in its own plain .ts module (no JSX) so it can be
// imported directly by a plain Vitest unit test — see
// tests/dashboard/setup-checklist.test.ts. This repo's test convention has no
// React render harness; UI wiring itself is verified by live click-through
// (see setup-checklist.tsx), while logic like this is unit-tested directly.
//
// "teamInvited" links to /settings/users (the tenant self-serve "Equipo" page, which invites
// into the CALLER'S org via the C# /tenant-invitations surface) — but only when the viewer holds
// user:create AND the tenant-invitations flag is on. Otherwise it is a status-only row: without the
// grant the page renders a no-permission state, and with the flag off it renders "unavailable" — a
// "Go" link to either dead end is the same failure `canManageBranding` guards below.
//
// `canManageBranding` (whole-branch review): hr_admin holds organization:read
// (sees this widget, including this row's DONE/not-done state) but not
// organization:update — the org-config settings page save always 403s for
// them by deliberate product design. hr_admin's own sidebar manifest never
// links to /settings/branding at all, but this widget's "Go" link is a raw
// route link independent of the nav manifest, so it must gate itself rather
// than rely on nav-invisibility to hide a dead end.
export function deriveSetupChecklistRows(
  items: SetupChecklistItems,
  labels: SetupChecklistLabels,
  canManageBranding: boolean,
  canInviteTeam = false,
  invitationsEnabled = false,
): SetupChecklistRow[] {
  const teamInviteHref = canInviteTeam && invitationsEnabled ? '/settings/users' : null;
  return [
    { key: 'companyStructureReady', label: labels.companyStructureReady, done: items.companyStructureReady, href: null },
    { key: 'teamInvited', label: labels.teamInvited, done: items.teamInvited, href: teamInviteHref },
    { key: 'brandingSet', label: labels.brandingSet, done: items.brandingSet, href: canManageBranding ? '/settings/branding' : null },
    { key: 'firstVacancyPosted', label: labels.firstVacancyPosted, done: items.firstVacancyPosted, href: '/recruitment/vacancies' },
    { key: 'firstVacancyPublished', label: labels.firstVacancyPublished, done: items.firstVacancyPublished, href: '/recruitment/vacancies' },
  ];
}
