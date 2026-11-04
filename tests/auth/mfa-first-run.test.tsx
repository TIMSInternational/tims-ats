import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// D-03 / E-20: the /mfa first run for a super_admin under MFA_ENFORCED — say why, continue to the app
// after the code, never lead with "Desactivar", confirm before disabling, and offer a real exit.

const state = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  verified: false,
  aal: 'aal1',
  challengeAndVerify: vi.fn(),
  unenroll: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push, refresh: state.refresh }) }));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.aal } }),
        listFactors: async () => {
          const factor = { id: 'factor-1', status: state.verified ? 'verified' : 'unverified' };
          return { data: { all: state.verified ? [factor] : [], totp: state.verified ? [factor] : [] } };
        },
        enroll: async () => ({
          data: { id: 'factor-1', totp: { qr_code: 'data:image/svg+xml;base64,PHN2Zy8+', secret: 'SECRET123' } },
          error: null,
        }),
        unenroll: state.unenroll,
        challengeAndVerify: state.challengeAndVerify,
      },
    },
  }),
}));

import { MfaSetup } from '../../apps/web/app/mfa/mfa-setup';
import { rememberPostLoginDestination } from '../../apps/web/lib/auth/post-login-destination';

beforeEach(() => {
  window.sessionStorage.clear();
  state.push.mockReset();
  state.refresh.mockReset();
  state.verified = false;
  state.aal = 'aal1';
  state.challengeAndVerify.mockReset();
  state.challengeAndVerify.mockResolvedValue({ error: null });
  state.unenroll.mockReset();
  state.unenroll.mockResolvedValue({ error: null });
});

const enterCode = () => {
  fireEvent.change(screen.getByLabelText(es.mfa.codeLabel), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: es.mfa.verify }));
};

describe('enforced first run', () => {
  it('explains the requirement and offers sign-out instead of a looping "Volver al panel"', async () => {
    render(<MfaSetup required />);
    expect(await screen.findByText(es.mfa.enrollTitle)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(es.mfa.enforcedNotice);
    expect(screen.getByRole('link', { name: es.mfa.signOut })).toHaveAttribute('href', '/logout');
    expect(screen.queryByRole('link', { name: es.mfa.backToDashboard })).toBeNull();
  });

  it('continues to the app after a successful enrollment, never to "Desactivar"', async () => {
    render(<MfaSetup required />);
    await screen.findByText(es.mfa.enrollTitle);
    enterCode();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/dashboard'));
    expect(state.refresh).toHaveBeenCalled();
    expect(screen.getByText(es.mfa.redirecting)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.mfa.disable })).toBeNull();
  });

  it('continues to the page the user was signing in to (login → MFA → deep link)', async () => {
    rememberPostLoginDestination('/recruitment/pipeline?vacancy=v1');
    render(<MfaSetup required />);
    await screen.findByText(es.mfa.enrollTitle);
    enterCode();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/recruitment/pipeline?vacancy=v1'));
    expect(window.sessionStorage.getItem('tims-post-login-destination')).toBeNull();
  });

  it('never offers "Desactivar" when the role requires MFA', async () => {
    state.verified = true;
    state.aal = 'aal2';
    render(<MfaSetup required />);
    expect(await screen.findByText(es.mfa.enabledTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.mfa.disable })).toBeNull();
    expect(screen.getByText(es.mfa.requiredCannotDisable)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: es.mfa.backToDashboard })).toHaveAttribute('href', '/dashboard');
  });

  it('returns to the invitation / password step that sent the user here', async () => {
    const returnTo = '/accept-invitation?token=11111111-1111-4111-8111-111111111111';
    render(<MfaSetup required={false} returnTo={returnTo} />);
    await screen.findByText(es.mfa.enrollTitle);
    expect(screen.getByRole('link', { name: es.mfa.signOut })).toHaveAttribute('href', '/logout');
    enterCode();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith(returnTo));
  });
});

describe('voluntary MFA', () => {
  it('does not reuse a remembered login destination for a voluntary visit', async () => {
    rememberPostLoginDestination('/recruitment/offers');
    render(<MfaSetup required={false} />);
    await screen.findByText(es.mfa.enrollTitle);
    enterCode();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/dashboard'));
  });

  it('keeps "Volver al panel" and shows no enforcement notice', async () => {
    render(<MfaSetup required={false} />);
    await screen.findByText(es.mfa.enrollTitle);
    expect(screen.queryByText(es.mfa.enforcedNotice)).toBeNull();
    expect(screen.getByRole('link', { name: es.mfa.backToDashboard })).toHaveAttribute('href', '/dashboard');
  });

  it('asks for confirmation before turning MFA off, and Cancel keeps it on', async () => {
    state.verified = true;
    state.aal = 'aal2';
    render(<MfaSetup required={false} />);
    fireEvent.click(await screen.findByRole('button', { name: es.mfa.disable }));
    expect(state.unenroll).not.toHaveBeenCalled();
    expect(screen.getByText(es.mfa.disableConfirm)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: es.mfa.cancel }));
    expect(screen.queryByText(es.mfa.disableConfirm)).toBeNull();
    expect(state.unenroll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: es.mfa.disable }));
    fireEvent.click(screen.getByRole('button', { name: es.mfa.disableConfirmBtn }));
    await waitFor(() => expect(state.unenroll).toHaveBeenCalledWith({ factorId: 'factor-1' }));
  });
});
