import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';

// company-admin-journeys-21: the widget used to hide only on the SERVER's `allComplete`, which
// requires a company to exist. An admin who cannot create one (org-structure flag off) could never
// complete the checklist, and "Ocultar por ahora" only bought 7 days. Completion is now computed
// client-side from the rows that are actually actionable.
//
// Items are injected (never read from a DB): #335 gives INVU a company, so no test here may assume
// a tenant with 0 companies.

const state = vi.hoisted(() => ({
  data: null as unknown,
  orgStructureEnabled: false,
  grants: new Set<string>(),
}));

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ organization: { getSetupStatus: { invalidate: vi.fn() } } }),
    organization: {
      getSetupStatus: {
        useQuery: () => ({ data: state.data, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      dismissSetupChecklist: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock('../../apps/web/lib/i18n', async () => {
  const messages = (await import('../../apps/web/lib/i18n/en.json')).default;
  return { useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: messages }) };
});
vi.mock('../../apps/web/lib/permissions', () => ({
  useCan:
    () =>
    (module: string, action = 'read') =>
      state.grants.has(`${module}:${action}`),
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/components', () => ({ ErrorState: () => <div>error</div> }));
vi.mock('../../apps/web/lib/platform-api/tenant-invitations', () => ({ isTenantInvitationsEnabled: () => false }));
// The same gate the /settings/business-units page branches on: off = read-only legacy viewer.
vi.mock('../../apps/web/lib/platform-api/org-structure', () => ({
  isOrgStructureViaCSharp: () => state.orgStructureEnabled,
}));

import { SetupChecklist } from '../../apps/web/app/(admin)/dashboard/setup-checklist';
import {
  deriveSetupChecklistRows,
  isSetupComplete,
  type SetupChecklistRow,
} from '../../apps/web/app/(admin)/dashboard/setup-checklist-rows';

const ALL_DONE = {
  companyStructureReady: true,
  teamInvited: true,
  brandingSet: true,
  firstVacancyPosted: true,
  firstVacancyPublished: true,
};

const status = (items: Partial<typeof ALL_DONE>, allComplete = false) => ({
  items: { ...ALL_DONE, ...items },
  allComplete,
  dismissedAt: null,
});

const LABELS = { ...en.setupChecklist };

const r = (key: SetupChecklistRow['key'], done: boolean, countsTowardCompletion: boolean): SetupChecklistRow => ({
  key,
  label: key,
  done,
  href: null,
  countsTowardCompletion,
});

beforeEach(() => {
  state.data = null;
  state.orgStructureEnabled = false;
  state.grants = new Set(['organization:read', 'organization:update', 'user:create']);
});

describe('isSetupComplete', () => {
  it('ignores rows that do not count toward completion', () => {
    expect(
      isSetupComplete([
        r('companyStructureReady', false, false),
        r('teamInvited', true, true),
        r('brandingSet', true, true),
      ]),
    ).toBe(true);
  });

  it('is false while any counted row is not done', () => {
    expect(isSetupComplete([r('companyStructureReady', true, true), r('teamInvited', false, true)])).toBe(false);
  });

  it('is true when every counted row is done', () => {
    expect(isSetupComplete([r('companyStructureReady', true, true), r('teamInvited', true, true)])).toBe(true);
  });
});

describe('SetupChecklist widget completion', () => {
  it('hides when every counted row is done, even though the server says allComplete=false', () => {
    // Org-structure flag off: the structure row is support-owned and excluded.
    state.data = status({ companyStructureReady: false }, false);
    const { container } = render(<SetupChecklist />);
    expect(container.innerHTML).toBe('');
  });

  it('hides with the org-structure flag on + organization:update when only the structure row is open (no in-app way to create a Company)', () => {
    state.orgStructureEnabled = true;
    state.data = status({ companyStructureReady: false }, false);
    const { container } = render(<SetupChecklist />);
    expect(container.innerHTML).toBe('');
  });

  it('flag on + organization:update with another row open: a NOT-done structure row has no link and reads support-owned', () => {
    state.orgStructureEnabled = true;
    state.data = status({ companyStructureReady: false, brandingSet: false }, false);
    render(<SetupChecklist />);
    expect(screen.getByText(en.setupChecklist.companyStructureBySupport)).toBeTruthy();
    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/settings/business-units');
  });

  it('flag on + organization:update with another row open: a DONE structure row renders no link (the row never carries one)', () => {
    state.orgStructureEnabled = true;
    state.data = status({ brandingSet: false }, false);
    render(<SetupChecklist />);
    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/settings/branding');
    expect(hrefs).not.toContain('/settings/business-units');
  });

  it('flag on but the viewer lacks organization:update (hr_admin): support label, no link, not counted', () => {
    state.orgStructureEnabled = true;
    state.grants = new Set(['organization:read', 'user:create']);
    state.data = status({ companyStructureReady: false }, false);
    const { container } = render(<SetupChecklist />);
    expect(container.innerHTML).toBe('');
  });

  it('flag off with another row open: shows the support-owned structure label and no link for it', () => {
    state.data = status({ companyStructureReady: false, brandingSet: false }, false);
    render(<SetupChecklist />);
    expect(screen.getByText(en.setupChecklist.companyStructureBySupport)).toBeTruthy();
    expect(screen.queryByText(en.setupChecklist.companyStructureReady)).toBeNull();
    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/settings/business-units');
  });

  it('teamInvited still follows the server boolean (PR-G has no people-admin dependency)', () => {
    state.data = status({ teamInvited: false }, false);
    render(<SetupChecklist />);
    expect(screen.getByText(en.setupChecklist.title)).toBeTruthy();

    const rows = deriveSetupChecklistRows(status({ teamInvited: false }).items, LABELS, {
      canManageBranding: true,
      canInviteTeam: true,
      invitationsEnabled: true,
    });
    expect(rows.find((x) => x.key === 'teamInvited')?.done).toBe(false);
    expect(isSetupComplete(rows)).toBe(false);
    const doneRows = deriveSetupChecklistRows(ALL_DONE, LABELS, {
      canManageBranding: true,
      canInviteTeam: true,
      invitationsEnabled: true,
    });
    expect(doneRows.find((x) => x.key === 'teamInvited')?.done).toBe(true);

    const src = readFileSync(
      // join(__dirname, ...), not new URL(..., import.meta.url): under happy-dom the module URL is not file://.
      join(__dirname, '../../apps/web/app/(admin)/dashboard/setup-checklist.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/tenant-people/);
  });

  it('a dismissal still hides the widget', () => {
    state.data = { ...status({ brandingSet: false }, false), dismissedAt: new Date().toISOString() };
    const { container } = render(<SetupChecklist />);
    expect(container.innerHTML).toBe('');
  });
});

describe('setupChecklist.companyStructureBySupport copy', () => {
  it('exists, non-empty, in both es and en', () => {
    const esSc = es.setupChecklist as Record<string, string>;
    const enSc = en.setupChecklist as Record<string, string>;
    expect(esSc.companyStructureBySupport?.trim()).toBeTruthy();
    expect(enSc.companyStructureBySupport?.trim()).toBeTruthy();
    expect(esSc.companyStructureBySupport).toMatch(/soporte TIMS/);
  });
});
