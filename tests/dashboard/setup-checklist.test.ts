import { describe, it, expect } from 'vitest';
import {
  deriveSetupChecklistRows,
  type SetupChecklistContext,
} from '../../apps/web/app/(admin)/dashboard/setup-checklist-rows';

const LABELS = {
  companyStructureReady: 'Company structure ready',
  companyStructureBySupport: 'Company structure: set up by TIMS support',
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

// Every capability off by default (fail-closed); each case opts in to what it needs.
const ctx = (overrides: Partial<SetupChecklistContext> = {}): SetupChecklistContext => ({
  canManageBranding: false,
  canInviteTeam: false,
  invitationsEnabled: false,
  orgStructureEnabled: false,
  canManageStructure: false,
  ...overrides,
});

const row = (rows: ReturnType<typeof deriveSetupChecklistRows>, key: string) => {
  const found = rows.find((r) => r.key === key);
  if (!found) throw new Error(`row ${key} missing`);
  return found;
};

describe('deriveSetupChecklistRows', () => {
  it('returns exactly 5 rows, in the fixed sprint order', () => {
    const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, ctx({ canManageBranding: true }));
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
      ctx({ canManageBranding: true }),
    );
    expect(row(rows, 'brandingSet').done).toBe(true);
    expect(row(rows, 'brandingSet').label).toBe(LABELS.brandingSet);
    expect(row(rows, 'firstVacancyPosted').done).toBe(true);
    expect(row(rows, 'teamInvited').done).toBe(false);
  });

  it('gives brandingSet, firstVacancyPosted, firstVacancyPublished real deep links', () => {
    const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, ctx({ canManageBranding: true }));
    expect(row(rows, 'brandingSet').href).toBe('/settings/branding');
    expect(row(rows, 'firstVacancyPosted').href).toBe('/recruitment/vacancies');
    expect(row(rows, 'firstVacancyPublished').href).toBe('/recruitment/vacancies');
  });

  it('brandingSet gets no deep link when the viewer lacks organization:update (hr_admin) — the settings page always 403s their save', () => {
    // Whole-branch review: hr_admin holds organization:read (sees this row's
    // done/not-done state) but not organization:update — the widget's "Go"
    // link is a raw route link independent of hr_admin's own nav manifest
    // (which never surfaces /settings/branding at all), so it must self-gate
    // rather than rely on nav-invisibility to avoid a dead-end link.
    const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, ctx({ canManageBranding: false }));
    expect(row(rows, 'brandingSet').href).toBeNull();
    // The other real links are unaffected by this flag.
    expect(row(rows, 'firstVacancyPosted').href).toBe('/recruitment/vacancies');
  });

  // company-admin-journeys-21: this row used to be hard-coded `href: null`, so with no company the
  // admin had a row they could never complete, and the dismissed widget came back every 7 days.
  describe('companyStructureReady (company-admin-journeys-21)', () => {
    // `companyStructureReady` is "a Company exists" (organization.getSetupStatus). No tenant surface
    // creates a Company: /settings/business-units manages units and teams, and creating a unit with
    // no Company is refused (company_required). So a NOT-done row is support-owned even with the
    // flag on and organization:update — a "Go" link there could never complete it.
    it('NOT done, flag on AND organization:update: still support-owned (the linked page cannot create a Company)', () => {
      const rows = deriveSetupChecklistRows(
        ALL_FALSE,
        LABELS,
        ctx({ orgStructureEnabled: true, canManageStructure: true }),
      );
      const structure = row(rows, 'companyStructureReady');
      expect(structure.href).toBeNull();
      expect(structure.label).toBe(LABELS.companyStructureBySupport);
      expect(structure.countsTowardCompletion).toBe(false);
    });

    it('DONE, flag on AND organization:update: links to /settings/business-units to manage the structure', () => {
      const rows = deriveSetupChecklistRows(
        { ...ALL_FALSE, companyStructureReady: true },
        LABELS,
        ctx({ orgStructureEnabled: true, canManageStructure: true }),
      );
      const structure = row(rows, 'companyStructureReady');
      expect(structure.href).toBe('/settings/business-units');
      expect(structure.label).toBe(LABELS.companyStructureReady);
      expect(structure.countsTowardCompletion).toBe(true);
    });

    it('DONE but flag off or no organization:update: no link (no dead end)', () => {
      for (const c of [ctx({ canManageStructure: true }), ctx({ orgStructureEnabled: true })]) {
        const structure = row(
          deriveSetupChecklistRows({ ...ALL_FALSE, companyStructureReady: true }, LABELS, c),
          'companyStructureReady',
        );
        expect(structure.href).toBeNull();
      }
    });

    it('flag OFF: status-only, labelled as support-owned, and excluded from completion', () => {
      const rows = deriveSetupChecklistRows(
        ALL_FALSE,
        LABELS,
        ctx({ orgStructureEnabled: false, canManageStructure: true }),
      );
      const structure = row(rows, 'companyStructureReady');
      expect(structure.href).toBeNull();
      expect(structure.label).toBe(LABELS.companyStructureBySupport);
      expect(structure.countsTowardCompletion).toBe(false);
    });

    it('flag ON but no organization:update: no dead-end link, support label, excluded from completion', () => {
      const rows = deriveSetupChecklistRows(
        ALL_FALSE,
        LABELS,
        ctx({ orgStructureEnabled: true, canManageStructure: false }),
      );
      const structure = row(rows, 'companyStructureReady');
      expect(structure.href).toBeNull();
      expect(structure.label).toBe(LABELS.companyStructureBySupport);
      expect(structure.countsTowardCompletion).toBe(false);
    });

    it('a DONE structure row keeps its original label and still counts, whatever the flag', () => {
      for (const c of [
        ctx(),
        ctx({ orgStructureEnabled: true }),
        ctx({ orgStructureEnabled: true, canManageStructure: true }),
      ]) {
        const structure = row(
          deriveSetupChecklistRows({ ...ALL_FALSE, companyStructureReady: true }, LABELS, c),
          'companyStructureReady',
        );
        expect(structure.done).toBe(true);
        expect(structure.label).toBe(LABELS.companyStructureReady);
        expect(structure.countsTowardCompletion).toBe(true);
      }
    });
  });

  it('every row other than the structure row always counts toward completion', () => {
    for (const c of [ctx(), ctx({ canManageBranding: true, canInviteTeam: true, invitationsEnabled: true })]) {
      const rows = deriveSetupChecklistRows(ALL_FALSE, LABELS, c);
      for (const key of ['teamInvited', 'brandingSet', 'firstVacancyPosted', 'firstVacancyPublished']) {
        expect(row(rows, key).countsTowardCompletion).toBe(true);
      }
    }
  });

  it('teamInvited links to /settings/users only for viewers who can create users AND with the flag on', () => {
    const on = ctx({ canManageBranding: true, canInviteTeam: true, invitationsEnabled: true });
    expect(row(deriveSetupChecklistRows(ALL_FALSE, LABELS, on), 'teamInvited').href).toBe('/settings/users');
    expect(row(deriveSetupChecklistRows({ ...ALL_FALSE, teamInvited: true }, LABELS, on), 'teamInvited').href).toBe(
      '/settings/users',
    );
  });

  it('teamInvited stays status-only with user:create when the tenant-invitations flag is OFF (no dead end)', () => {
    expect(
      row(
        deriveSetupChecklistRows(ALL_FALSE, LABELS, ctx({ canInviteTeam: true, invitationsEnabled: false })),
        'teamInvited',
      ).href,
    ).toBeNull();
  });

  it('teamInvited stays status-only (no dead-end link) when the viewer lacks user:create', () => {
    expect(
      row(
        deriveSetupChecklistRows(ALL_FALSE, LABELS, ctx({ canInviteTeam: false, invitationsEnabled: true })),
        'teamInvited',
      ).href,
    ).toBeNull();
  });
});
