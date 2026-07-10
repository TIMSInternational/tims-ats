import { describe, it, expect } from 'vitest';
import { deriveSetupChecklistRows } from '../../apps/web/app/(admin)/dashboard/setup-checklist-rows';

const LABELS = {
  companyStructureReady: 'Company structure ready',
  teamInvited: 'Invite your team',
  brandingSet: 'Set your candidate-portal branding',
  firstVacancyPosted: 'Post your first vacancy',
  firstVacancyPublished: 'Publish it',
};

const ALL_FALSE = {
  companyStructureReady: false,
  teamInvited: false,
  brandingSet: false,
  firstVacancyPosted: false,
  firstVacancyPublished: false,
};

describe('deriveSetupChecklistRows', () => {
  it('returns exactly 5 rows, in the fixed sprint order', () => {
    const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, true);
    expect(rows.map((r) => r.key)).toEqual([
      'companyStructureReady',
      'teamInvited',
      'brandingSet',
      'firstVacancyPosted',
      'firstVacancyPublished',
    ]);
  });

  it('carries each item boolean through to `done` and the matching label through to `label`', () => {
    const rows = deriveSetupChecklistRows(
      { ...ALL_FALSE, brandingSet: true, firstVacancyPosted: true },
      LABELS,
      true,
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.brandingSet.done).toBe(true);
    expect(byKey.brandingSet.label).toBe(LABELS.brandingSet);
    expect(byKey.firstVacancyPosted.done).toBe(true);
    expect(byKey.teamInvited.done).toBe(false);
  });

  it('gives brandingSet, firstVacancyPosted, firstVacancyPublished real deep links', () => {
    const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, true);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.brandingSet.href).toBe('/settings/branding');
    expect(byKey.firstVacancyPosted.href).toBe('/recruitment/vacancies');
    expect(byKey.firstVacancyPublished.href).toBe('/recruitment/vacancies');
  });

  it('brandingSet gets no deep link when the viewer lacks organization:update (hr_admin) — the settings page always 403s their save', () => {
    // Whole-branch review: hr_admin holds organization:read (sees this row's
    // done/not-done state) but not organization:update — the widget's "Go"
    // link is a raw route link independent of hr_admin's own nav manifest
    // (which never surfaces /settings/branding at all), so it must self-gate
    // rather than rely on nav-invisibility to avoid a dead-end link.
    const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, false);
    expect(rows.find((r) => r.key === 'brandingSet')?.href).toBeNull();
    // The other real links are unaffected by this flag.
    expect(rows.find((r) => r.key === 'firstVacancyPosted')?.href).toBe('/recruitment/vacancies');
  });

  it('companyStructureReady never gets a deep link (auto-satisfied by provisioning, no page to send the admin to)', () => {
    const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, true);
    const row = rows.find((r) => r.key === 'companyStructureReady');
    expect(row?.href).toBeNull();

    const rowsDone = deriveSetupChecklistRows({ ...ALL_FALSE, companyStructureReady: true }, LABELS, true);
    expect(rowsDone.find((r) => r.key === 'companyStructureReady')?.href).toBeNull();
  });

  it('teamInvited NEVER gets a deep link, whether complete or not — there is no self-serve org-admin invite entry point in this codebase (product gap, out of scope for this widget)', () => {
    const incomplete = deriveSetupChecklistRows(ALL_FALSE, LABELS, true);
    expect(incomplete.find((r) => r.key === 'teamInvited')?.href).toBeNull();

    const complete = deriveSetupChecklistRows({ ...ALL_FALSE, teamInvited: true }, LABELS, true);
    expect(complete.find((r) => r.key === 'teamInvited')?.href).toBeNull();
  });
});
