import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: vi.fn() }));

import LoginPage from '../../apps/web/app/(auth)/login/page';

describe('staff login page', () => {
  it('associates each input with its visible label', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(es.auth.email)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(es.auth.password)).toHaveAttribute('type', 'password');
  });

  it('uses accented Spanish copy', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeInTheDocument();
    expect(screen.getByText('¿Olvidaste tu contraseña?')).toBeInTheDocument();
    expect(screen.getByText(/¿No tienes cuenta\?/)).toBeInTheDocument();
  });
});
