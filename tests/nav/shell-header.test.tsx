import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// The header every INVU staff user sees on every page (navbar + bell + owner search).

const { state } = vi.hoisted(() => ({
  state: {
    pathname: '/dashboard',
    unread: 0,
    notifications: [] as Array<Record<string, unknown>>,
    searchPages: [] as Array<{ name: string; href: string }>,
    searchCalls: 0,
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    notification: {
      unreadCount: {
        useQuery: () => ({ data: { count: state.unread }, isError: false, error: null, refetch: vi.fn() }),
      },
      list: {
        useQuery: () => ({
          data: { notifications: state.notifications },
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      markAsRead: { useMutation: () => ({ mutate: vi.fn() }) },
      markAllAsRead: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock('../../apps/web/lib/platform-api/dashboard', () => ({
  useDashboardSearch: () => {
    state.searchCalls += 1;
    return {
      data: { organizations: [], users: [], pages: state.searchPages },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));
vi.mock('../../apps/web/app/(admin)/navbar/support-email-link', () => ({ SupportEmailLink: () => null }));

import { Navbar } from '../../apps/web/app/(admin)/navbar/index';
import { NotificationDropdown } from '../../apps/web/app/(admin)/navbar/notification-dropdown';
import { SearchCommand } from '../../apps/web/app/(admin)/navbar/search-command';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  state.pathname = '/dashboard';
  state.unread = 0;
  state.notifications = [];
  state.searchPages = [];
  state.searchCalls = 0;
});

const notif = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  read: false,
  type: 'critical',
  title: 'Nueva solicitud de supresión de datos',
  message: null,
  module: 'candidate',
  actionUrl: null,
  createdAt: new Date(),
  ...over,
});

describe('header search (platform-owner only)', () => {
  it('is not rendered for a tenant user, so it never calls the owner-only search', () => {
    render(<Navbar isPlatformOwner={false} />);
    expect(screen.queryByPlaceholderText(es.nav.search)).toBeNull();
    expect(state.searchCalls).toBe(0);
  });

  it('is rendered for a platform owner', () => {
    render(<Navbar isPlatformOwner />);
    expect(screen.getByPlaceholderText(es.nav.search)).toBeTruthy();
  });

  it('drops page results the pilot scope hides (Feature Flags would open AccessDenied)', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    state.searchPages = [
      { name: 'Feature Flags', href: '/platform/feature-flags' },
      { name: 'Organizaciones', href: '/platform/organizations' },
    ];
    render(<SearchCommand />);
    const input = screen.getByPlaceholderText(es.nav.search);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'f' } });
    expect(screen.queryByText('Feature Flags')).toBeNull();
    expect(screen.getByText('Organizaciones')).toBeTruthy();
  });
});

describe('navbar breadcrumb + accessible names', () => {
  it('shows the Spanish crumb for a settings page instead of the product name', () => {
    state.pathname = '/settings/users';
    render(<Navbar />);
    expect(screen.getByText('Equipo')).toBeTruthy();
    expect(screen.queryByText('TIMS Platform')).toBeNull();
  });

  it('names the hamburger and the language switch in Spanish', () => {
    render(<Navbar />);
    expect(screen.getByRole('button', { name: es.nav.menu })).toBeTruthy();
    const lang = screen.getByRole('button', { name: `${es.nav.language}: Español` });
    expect(lang.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(lang);
    expect(lang.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('notification bell', () => {
  it('has an accessible name with the unread count and reports its expanded state', () => {
    state.unread = 3;
    render(<NotificationDropdown />);
    const bell = screen.getByRole('button', { name: `${es.nav.notifications} (3 ${es.nav.unread})` });
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bell);
    expect(bell.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not offer "Ver todas" to a tenant user (/platform/notifications would bounce them home)', () => {
    state.notifications = [notif()];
    render(<NotificationDropdown isPlatformOwner={false} />);
    fireEvent.click(screen.getByRole('button', { name: es.nav.notifications }));
    expect(screen.queryByText(es.nav.viewAll)).toBeNull();
  });

  it('offers "Ver todas" to a platform owner', () => {
    state.notifications = [notif()];
    render(<NotificationDropdown isPlatformOwner />);
    fireEvent.click(screen.getByRole('button', { name: es.nav.notifications }));
    expect(screen.getByText(es.nav.viewAll)).toBeTruthy();
  });

  it('labels the module chip in Spanish, hides unknown slugs, and names the severity for screen readers', () => {
    state.notifications = [notif(), notif({ id: 'n2', module: 'some_internal_slug', type: 'info', title: 'Aviso' })];
    render(<NotificationDropdown />);
    fireEvent.click(screen.getByRole('button', { name: es.nav.notifications }));
    expect(screen.getByText(es.nav.notificationModules.candidate)).toBeTruthy();
    expect(screen.queryByText('candidate')).toBeNull();
    expect(screen.queryByText('some_internal_slug')).toBeNull();
    expect(screen.getByText(`${es.nav.notificationTypes.critical}:`)).toBeTruthy();
  });

  it('empty state no longer promises alerts the pilot never sends', () => {
    render(<NotificationDropdown />);
    fireEvent.click(screen.getByRole('button', { name: es.nav.notifications }));
    expect(screen.getByText(es.nav.noNotificationsDesc)).toBeTruthy();
    expect(es.nav.noNotificationsDesc).not.toMatch(/Cuando algo importante pase/);
  });

  it('pins the panel to the viewport on phones instead of overflowing the left edge', () => {
    render(<NotificationDropdown />);
    fireEvent.click(screen.getByRole('button', { name: es.nav.notifications }));
    const panel = screen.getByText(es.nav.notifications, { selector: 'h3' }).closest('div.fixed');
    expect(panel?.className).toContain('inset-x-4');
    expect(panel?.className).toContain('md:absolute');
  });
});
