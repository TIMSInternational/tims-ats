import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const { state } = vi.hoisted(() => ({ state: { pathname: '/dashboard' } }));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    auth: {
      getSessionInfo: {
        useQuery: () => ({
          data: { roles: ['super_admin'], permissions: [], user: { id: 'u1' } },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

import { ErrorState } from '../../apps/web/components/error-state';
import { isForbiddenError } from '../../apps/web/lib/forbidden-error';
import { PermissionsProvider, RouteAccessGuard } from '../../apps/web/lib/permissions';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  state.pathname = '/dashboard';
});

describe('isForbiddenError', () => {
  it('recognises a tRPC FORBIDDEN (code or 403) and a C# PlatformApiError 403', () => {
    expect(isForbiddenError({ message: 'x', data: { code: 'FORBIDDEN', httpStatus: 403 } })).toBe(true);
    expect(isForbiddenError({ data: { httpStatus: 403 } })).toBe(true);
    expect(isForbiddenError({ name: 'PlatformApiError', status: 403 })).toBe(true);
  });

  it('is false for every other failure', () => {
    expect(isForbiddenError(undefined)).toBe(false);
    expect(isForbiddenError(null)).toBe(false);
    expect(isForbiddenError(new Error('network'))).toBe(false);
    expect(isForbiddenError({ data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } })).toBe(false);
    expect(isForbiddenError({ data: { code: 'UNAUTHORIZED', httpStatus: 401 } })).toBe(false);
    expect(isForbiddenError({ status: 404 })).toBe(false);
    expect(isForbiddenError('FORBIDDEN')).toBe(false);
  });
});

describe('ErrorState', () => {
  it('a permission denial reads "no access" and offers no retry (it can never succeed)', () => {
    const retry = vi.fn();
    render(<ErrorState onRetry={retry} error={{ data: { code: 'FORBIDDEN', httpStatus: 403 } }} />);
    expect(screen.getByText(es.common.errorForbidden)).toBeTruthy();
    expect(screen.queryByText(es.common.error)).toBeNull();
    expect(screen.queryByRole('button', { name: es.common.retry })).toBeNull();
  });

  it('the no-access copy wins over a caller message meant for load failures', () => {
    render(<ErrorState message="No se pudieron cargar los miembros" error={{ status: 403 }} />);
    expect(screen.getByText(es.common.errorForbidden)).toBeTruthy();
  });

  it('any other failure keeps the generic message and the retry button', () => {
    const retry = vi.fn();
    render(<ErrorState onRetry={retry} error={new Error('boom')} />);
    expect(screen.getByText(es.common.error)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: es.common.retry }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('AccessDenied on a pilot-hidden route', () => {
  const guard = () =>
    render(
      <PermissionsProvider isPlatformOwner={false}>
        <RouteAccessGuard>
          <p>contenido</p>
        </RouteAccessGuard>
      </PermissionsProvider>,
    );

  it('says the module is not in the pilot, not that a permission is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    state.pathname = '/talent/nine-box';
    guard();
    expect(screen.getByText(es.accessDenied.pilotTitle)).toBeTruthy();
    expect(screen.getByText(es.accessDenied.pilotMessage)).toBeTruthy();
    expect(screen.queryByText(es.accessDenied.message)).toBeNull();
    expect(screen.queryByText('contenido')).toBeNull();
  });

  it('a visible route renders normally', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    state.pathname = '/recruitment/vacancies';
    guard();
    expect(screen.getByText('contenido')).toBeTruthy();
  });
});
