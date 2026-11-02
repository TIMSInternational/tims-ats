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
  /** False for a row the viewer cannot act on (support-owned): it never blocks completion. */
  countsTowardCompletion: boolean;
}

export interface SetupChecklistLabels {
  companyStructureReady: string;
  companyStructureBySupport: string;
  teamInvited: string;
  brandingSet: string;
  firstVacancyPosted: string;
  firstVacancyPublished: string;
}

/** What the viewer can do, and which surfaces are switched on, for the row links. */
export interface SetupChecklistContext {
  canManageBranding: boolean;
  canInviteTeam: boolean;
  invitationsEnabled: boolean;
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
//
// "companyStructureReady" (company-admin-journeys-21) means "a Company exists". No tenant surface
// creates a Company: /settings/business-units manages units and teams, and creating a unit with no
// Company is refused (company_required). So while NOT done the row is always support-owned: the
// support label, and excluded from completion, so it can no longer keep the widget open (or re-open
// it every 7 days). It never carries a link: not done there is nothing in-app to complete it with,
// and done rows render no link at all.
export function deriveSetupChecklistRows(
  items: SetupChecklistItems,
  labels: SetupChecklistLabels,
  ctx: SetupChecklistContext,
): SetupChecklistRow[] {
  const teamInviteHref = ctx.canInviteTeam && ctx.invitationsEnabled ? '/settings/users' : null;
  const structureBySupport = !items.companyStructureReady;
  return [
    {
      key: 'companyStructureReady',
      label: structureBySupport ? labels.companyStructureBySupport : labels.companyStructureReady,
      done: items.companyStructureReady,
      href: null,
      countsTowardCompletion: !structureBySupport,
    },
    { key: 'teamInvited', label: labels.teamInvited, done: items.teamInvited, href: teamInviteHref, countsTowardCompletion: true },
    {
      key: 'brandingSet',
      label: labels.brandingSet,
      done: items.brandingSet,
      href: ctx.canManageBranding ? '/settings/branding' : null,
      countsTowardCompletion: true,
    },
    {
      key: 'firstVacancyPosted',
      label: labels.firstVacancyPosted,
      done: items.firstVacancyPosted,
      href: '/recruitment/vacancies',
      countsTowardCompletion: true,
    },
    {
      key: 'firstVacancyPublished',
      label: labels.firstVacancyPublished,
      done: items.firstVacancyPublished,
      href: '/recruitment/vacancies',
      countsTowardCompletion: true,
    },
  ];
}

/** Client-side completion: every row that counts is done. Support-owned rows are ignored. */
export function isSetupComplete(rows: readonly SetupChecklistRow[]): boolean {
  return rows.every((row) => !row.countsTowardCompletion || row.done);
}
