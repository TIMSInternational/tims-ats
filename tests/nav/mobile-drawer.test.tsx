import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// The phone drawer: always expanded (the collapsed icon rail is a desktop preference), with a close
// button and Escape.

type SidebarProps = { expanded: boolean; onClose?: () => void };
// vi.mock factories are hoisted above module-level consts, so the fakes live in vi.hoisted.
const { pass, FakeSidebar } = vi.hoisted(() => ({
  pass: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  FakeSidebar: ({ expanded, onClose }: SidebarProps) => (
    <div data-testid="sidebar" data-expanded={String(expanded)}>
      <button onClick={onClose}>cerrar-drawer</button>
    </div>
  ),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../apps/web/lib/i18n', () => ({ I18nProvider: pass, useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/trpc-provider', () => ({ TRPCProvider: pass }));
vi.mock('../../apps/web/lib/permissions', () => ({ PermissionsProvider: pass, RouteAccessGuard: pass }));
vi.mock('../../apps/web/app/(admin)/sidebar', () => ({ Sidebar: FakeSidebar }));
vi.mock('../../apps/web/app/(admin)/participant-sidebar', () => ({ ParticipantSidebar: FakeSidebar }));
vi.mock('../../apps/web/app/(admin)/platform-sidebar', () => ({ PlatformSidebar: FakeSidebar }));
vi.mock('../../apps/web/app/(admin)/impersonation-banner', () => ({ ImpersonationBanner: () => null }));
vi.mock('../../apps/web/app/(admin)/navbar/index', () => ({
  Navbar: ({ onMenuClick }: { onMenuClick?: () => void }) => <button onClick={onMenuClick}>abrir-menu</button>,
}));

import { AdminShell } from '../../apps/web/app/(admin)/admin-shell';
import { SidebarDrawerClose } from '../../apps/web/app/(admin)/sidebar-drawer-close';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderShell() {
  localStorage.setItem('tims-sidebar-expanded', 'false'); // desktop preference: collapsed rail
  render(
    <AdminShell userInitials="AB" displayName="Ana B" isPlatformOwner={false} shell="admin">
      <p>page</p>
    </AdminShell>,
  );
  return () => screen.getByTestId('sidebar').getAttribute('data-expanded');
}

describe('mobile sidebar drawer', () => {
  it('opens expanded even when the desktop preference is collapsed', () => {
    const expanded = renderShell();
    expect(expanded()).toBe('false');
    fireEvent.click(screen.getByText('abrir-menu'));
    expect(expanded()).toBe('true');
  });

  it('closes on Escape', () => {
    const expanded = renderShell();
    fireEvent.click(screen.getByText('abrir-menu'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(expanded()).toBe('false');
  });

  it('closes from the sidebar close button', () => {
    const expanded = renderShell();
    fireEvent.click(screen.getByText('abrir-menu'));
    fireEvent.click(screen.getByText('cerrar-drawer'));
    expect(expanded()).toBe('false');
  });

  it('the close button has a Spanish accessible name and is phone-only', () => {
    const onClose = vi.fn();
    render(<SidebarDrawerClose onClose={onClose} label={es.nav.closeMenu} />);
    const btn = screen.getByRole('button', { name: 'Cerrar menú' });
    expect(btn.className).toContain('md:hidden');
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
