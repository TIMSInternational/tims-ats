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
// "teamInvited" deliberately gets href: null even while incomplete: there is
// no self-serve org-admin invite entry point anywhere in this codebase today.
// The only invite flows that exist (platform/invitations/*, platform/users/
// invite-wizard.tsx) live under the platform-owner-only console — a regular
// org super_admin/hr_admin cannot reach those routes at all. Linking this row
// to a page that doesn't actually invite anyone into THIS org would be a
// broken/misleading deep link, so it renders as a status-only row instead.
// Building a real self-serve org-admin invite flow is a substantial feature
// (email tokens, account provisioning) — out of scope for this widget task;
// flagged as a product gap for a future sprint.
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
): SetupChecklistRow[] {
  return [
    { key: 'companyStructureReady', label: labels.companyStructureReady, done: items.companyStructureReady, href: null },
    { key: 'teamInvited', label: labels.teamInvited, done: items.teamInvited, href: null },
    { key: 'brandingSet', label: labels.brandingSet, done: items.brandingSet, href: canManageBranding ? '/settings/branding' : null },
    { key: 'firstVacancyPosted', label: labels.firstVacancyPosted, done: items.firstVacancyPosted, href: '/recruitment/vacancies' },
    { key: 'firstVacancyPublished', label: labels.firstVacancyPublished, done: items.firstVacancyPublished, href: '/recruitment/vacancies' },
  ];
}
