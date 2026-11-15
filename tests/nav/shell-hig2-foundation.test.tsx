import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// HIG pass, second round (foundation): the drawer footer stays pinned on phones, the platform owner keeps
// global search below md, participant tabs get single-word labels.

const { state } = vi.hoisted(() => ({
  state: { pathname: '/dashboard', searchPages: [] as Array<{ name: string; href: string }>, push: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: state.push, refresh: vi.fn() }),
}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }) }));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock('../../apps/web/lib/platform-api/dashboard', () => ({
  useDashboardSearch: () => ({
    data: { organizations: [], users: [], pages: state.searchPages },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({ can: () => true, roles: ['employee'], isLoading: false }),
}));

import { SidebarFrame } from '../../apps/web/app/(admin)/sidebar-frame';
import { SearchSheetButton } from '../../apps/web/app/(admin)/navbar/search-sheet-button';
import { ParticipantTabBar } from '../../apps/web/app/(admin)/participant-tab-bar';

afterEach(() => {
  cleanup();
  state.pathname = '/dashboard';
  state.searchPages = [];
  state.push.mockReset();
});

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('sidebar frame on a phone (platform-owner drawer regression)', () => {
  function renderFrame() {
    const items = Array.from({ length: 30 }, (_, i) => ({
      href: `/platform/page-${i}`,
      label: `Página ${i}`,
      icon: 'grid',
      active: i === 29,
    }));
    return render(
      <SidebarFrame
        sections={[{ label: null, items }]}
        expanded
        onToggle={vi.fn()}
        onClose={vi.fn()}
        ready
        userInitials="PO"
        displayName="Platform Owner"
        roleLabel="Owner"
      />,
    );
  }

  it('lets only the nav scroll: it can shrink (min-h-0) and the aside is not a scroll container', () => {
    const { container } = renderFrame();
    const aside = container.querySelector('aside');
    const nav = screen.getByRole('navigation', { name: es.nav.mainNav });
    expect(classes(nav)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']));
    // overflow-hidden is still programmatically scrollable (scrollIntoView, focus); overflow-clip is not.
    expect(classes(aside)).toContain('overflow-clip');
    expect(classes(aside)).not.toContain('overflow-hidden');
    expect(classes(aside)).toContain('max-h-dvh');
  });

  it('keeps the profile footer (sign-out) outside the scrolling nav, as a non-shrinking sibling', () => {
    const { container } = renderFrame();
    const nav = screen.getByRole('navigation', { name: es.nav.mainNav });
    const footer = nav.nextElementSibling;
    expect(footer).not.toBeNull();
    expect(classes(footer)).toContain('shrink-0');
    expect(nav.contains(footer)).toBe(false);
    expect(within(footer as HTMLElement).getByText('Platform Owner')).toBeTruthy();
    expect(container.querySelector('aside')?.lastElementChild).toBe(footer);
  });
});

describe('platform-owner search below md', () => {
  it('opens the search in a full-screen sheet with the combobox focused', () => {
    render(<SearchSheetButton />);
    const trigger = screen.getByRole('button', { name: es.nav.openSearch });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: es.nav.searchSheetTitle });
    const input = within(dialog).getByRole('combobox', { name: es.nav.searchLabel });
    expect(document.activeElement).toBe(input);
    expect(classes(input)).toContain('w-full');
  });

  it('shows results inline and closes the sheet after picking one', () => {
    state.searchPages = [{ name: 'Organizaciones', href: '/platform/organizations' }];
    render(<SearchSheetButton />);
    fireEvent.click(screen.getByRole('button', { name: es.nav.openSearch }));
    const input = screen.getByRole('combobox', { name: es.nav.searchLabel });
    fireEvent.change(input, { target: { value: 'org' } });
    fireEvent.click(screen.getByRole('option', { name: /Organizaciones/ }));
    expect(state.push).toHaveBeenCalledWith('/platform/organizations');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('participant tab bar labels', () => {
  it('uses single-word labels and keeps the full name as the accessible name', () => {
    render(<ParticipantTabBar />);
    const bar = screen.getByRole('navigation', { name: es.nav.mainNav });
    const performance = within(bar).getByRole('link', { name: es.sidebar.myPerformance });
    expect(performance.textContent?.trim()).toBe(es.nav.tabLabels.myPerformance);
    expect(within(bar).getByRole('link', { name: es.sidebar.myLearning }).textContent?.trim()).toBe(
      es.nav.tabLabels.myLearning,
    );
    // Home is already one word: no aria-label override.
    expect(within(bar).getByRole('link', { name: es.sidebar.commandCenter }).getAttribute('aria-label')).toBeNull();
  });
});
