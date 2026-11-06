import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// Portal login, two re-audit gaps:
//  - C-25: the tile shows the organization's logo or initial (from the careers layout), never the platform "T".
//  - E-19 / #410: with another account signed in this browser, sending the email or verifying the code is held
//    behind "Tiene una sesión abierta como {email}" and an explicit sign-out (usted copy).

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
}));
const search = vi.hoisted(() => ({ value: '' }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'invu' }),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: () => ({ auth }) }));
vi.mock('../../apps/web/lib/auth/canonical-auth-origin', () => ({
  ensureCanonicalAuthOrigin: () => true,
  useCanonicalAuthOrigin: () => undefined,
}));

import PortalLoginPage from '../../apps/web/app/(portal)/careers/[orgSlug]/login/page';
import { PortalOrgBrandProvider } from '../../apps/web/app/(portal)/careers/[orgSlug]/_components/portal-org-brand';

const m = es.portalAuth;
const STAFF = 'reclutadora@invu.example';
const staffSession = { data: { session: { user: { email: STAFF } } } };

async function requestEmail(address: string) {
  fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: m.sendLink }));
  });
}

beforeEach(() => {
  search.value = '';
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('portal login tile (C-25)', () => {
  it('shows the organization initial from the careers layout, not a hard-coded T', () => {
    render(
      <PortalOrgBrandProvider brand={{ name: 'INVU', logo: null }}>
        <PortalLoginPage />
      </PortalOrgBrandProvider>,
    );
    expect(screen.getByRole('img', { name: 'INVU' })).toHaveTextContent('I');
    expect(screen.queryByText('T')).toBeNull();
  });

  it('shows the organization logo when it has one', () => {
    render(
      <PortalOrgBrandProvider brand={{ name: 'INVU', logo: 'https://abc.supabase.co/storage/v1/object/public/logos/invu.png' }}>
        <PortalLoginPage />
      </PortalOrgBrandProvider>,
    );
    expect(screen.getByRole('img', { name: 'INVU' })).toHaveAttribute('src', 'https://abc.supabase.co/storage/v1/object/public/logos/invu.png');
  });
});

describe('portal login over an open session (E-19)', () => {
  it('sends normally when no session is open', async () => {
    render(<PortalLoginPage />);
    await requestEmail('candidata@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(m.openSessionContinue)).toBeNull();
  });

  it('does not send while another account is signed in, and continues after an explicit sign-out', async () => {
    auth.getSession.mockResolvedValue(staffSession);
    render(<PortalLoginPage />);
    await requestEmail('candidata@example.com');

    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(screen.getByText(m.openSession.replace('{email}', STAFF))).toBeInTheDocument();

    auth.getSession.mockResolvedValue({ data: { session: null } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: m.openSessionContinue }));
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.queryByText(m.openSession.replace('{email}', STAFF))).toBeNull();

    await requestEmail('candidata@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('does not warn when the open session is the same candidate', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { email: 'Candidata@Example.com' } } } });
    render(<PortalLoginPage />);
    await requestEmail('candidata@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('explains a link the callback did not use because a staff session is open', async () => {
    search.value = 'error=open_session';
    auth.getSession.mockResolvedValue(staffSession);
    await act(async () => {
      render(<PortalLoginPage />);
    });
    expect(screen.getByText(m.openSessionFromLink.replace('{email}', STAFF))).toBeInTheDocument();
  });

  it('keeps the warning and says so when the sign-out fails', async () => {
    auth.getSession.mockResolvedValue(staffSession);
    auth.signOut.mockResolvedValue({ error: { message: 'network' } });
    render(<PortalLoginPage />);
    await requestEmail('candidata@example.com');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: m.openSessionContinue }));
    });
    expect(screen.getByText(m.openSessionFailed)).toBeInTheDocument();
    expect(screen.getByText(m.openSession.replace('{email}', STAFF))).toBeInTheDocument();
  });
});
