import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// Audit C-33 — the candidate portal's account actions: "Retirar mi postulación" on an application still in
// process, and "Mis datos" (correct name, phone, location; the email is the login and stays read-only).

type MutationOptions = { onSuccess?: (data: unknown) => unknown; onError?: (err: unknown) => unknown };

const mocks = vi.hoisted(() => ({
  applications: [] as unknown[],
  withdrawMutate: vi.fn(),
  withdrawOptions: {} as MutationOptions,
  profileMutate: vi.fn(),
  profileOptions: {} as MutationOptions,
  invalidateApplications: vi.fn(),
  invalidateStatus: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      candidatePortal: {
        myApplications: { invalidate: mocks.invalidateApplications },
        applicationStatus: { invalidate: mocks.invalidateStatus },
      },
    }),
    candidatePortal: {
      myApplications: { useQuery: () => ({ data: mocks.applications, isLoading: false, isError: false }) },
      applicationStatus: {
        useQuery: () => ({ data: { status: 'active', movements: [] }, isLoading: false, isError: false }),
      },
      withdrawMyApplication: {
        useMutation: (options: MutationOptions) => {
          mocks.withdrawOptions = options;
          return { mutate: mocks.withdrawMutate, isPending: false };
        },
      },
      updateMyProfile: {
        useMutation: (options: MutationOptions) => {
          mocks.profileOptions = options;
          return { mutate: mocks.profileMutate, isPending: false };
        },
      },
    },
  },
}));

import { DashboardApplications } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-applications';
import { withdrawErrorMessage } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-withdraw-application';
import { DashboardProfile } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-profile';

const pd = es.portalDashboard;

const app = (id: string, status: string, title: string) => ({
  id,
  status,
  appliedAt: '2026-11-05T15:00:00.000Z',
  vacancy: { title, company: null },
  currentStage: { name: 'Screening' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.applications = [
    app('a1', 'active', 'Analista'),
    app('a2', 'rejected', 'Contador'),
    app('a3', 'withdrawn', 'Asistente'),
  ];
});

describe('Retirar mi postulación', () => {
  it('is offered only on an application still in process', () => {
    render(<DashboardApplications orgSlug="acme" orgName="Acme" timeZone="America/Costa_Rica" />);
    const buttons = screen.getAllByRole('button', { name: pd.withdrawAction });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.closest('li')?.textContent).toContain('Analista');
    // The already-withdrawn one reads "Retirada".
    expect(screen.getByText('Asistente').closest('li')?.textContent).toContain(pd.statusWithdrawn);
  });

  it('asks for confirmation, then withdraws only that application and refreshes the list', async () => {
    render(<DashboardApplications orgSlug="acme" orgName="Acme" />);
    fireEvent.click(screen.getByRole('button', { name: pd.withdrawAction }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(
      pd.withdrawConfirmBody.replace('{vacancy}', 'Analista').replace('{org}', 'Acme'),
    );
    expect(mocks.withdrawMutate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: pd.withdrawConfirm }));
    expect(mocks.withdrawMutate).toHaveBeenCalledWith({ orgSlug: 'acme', applicationId: 'a1' });

    await mocks.withdrawOptions.onSuccess?.({ id: 'a1', status: 'withdrawn' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.invalidateApplications).toHaveBeenCalledWith({ orgSlug: 'acme' });
    expect(mocks.invalidateStatus).toHaveBeenCalledWith({ orgSlug: 'acme', applicationId: 'a1' });
    expect(mocks.toast).toHaveBeenCalledWith(pd.withdrawDone.replace('{vacancy}', 'Analista'), { type: 'success' });
  });

  it('cancel closes the dialog without withdrawing', () => {
    render(<DashboardApplications orgSlug="acme" orgName="Acme" />);
    fireEvent.click(screen.getByRole('button', { name: pd.withdrawAction }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: pd.withdrawCancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.withdrawMutate).not.toHaveBeenCalled();
  });

  it('explains an open offer inside the dialog (and as a toast)', async () => {
    render(<DashboardApplications orgSlug="acme" orgName="Acme" />);
    fireEvent.click(screen.getByRole('button', { name: pd.withdrawAction }));
    await mocks.withdrawOptions.onError?.({ data: { code: 'PRECONDITION_FAILED' } });
    const expected = pd.withdrawErrorOpenOffer.replace('{org}', 'Acme');
    expect((await screen.findByRole('alert')).textContent).toBe(expected);
    expect(mocks.toast).toHaveBeenCalledWith(expected, { type: 'error' });
  });

  it('maps every server outcome to candidate copy, never a raw server message', () => {
    expect(withdrawErrorMessage('CONFLICT', pd, 'Acme')).toBe(pd.withdrawErrorNotActive);
    expect(withdrawErrorMessage('PRECONDITION_FAILED', pd, 'Acme')).toBe(
      pd.withdrawErrorOpenOffer.replace('{org}', 'Acme'),
    );
    expect(withdrawErrorMessage('NOT_FOUND', pd, 'Acme')).toBe(pd.withdrawErrorGeneric);
    expect(withdrawErrorMessage('TOO_MANY_REQUESTS', pd, 'Acme')).toBe(pd.withdrawErrorGeneric);
    expect(withdrawErrorMessage(undefined, pd, 'Acme')).toBe(pd.withdrawErrorGeneric);
  });
});

describe('Mis datos', () => {
  const profile = { firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com', phone: null, location: 'Heredia' };

  it('shows the current details, the email included, with "Sin indicar" for a blank field', () => {
    const { container } = render(<DashboardProfile orgSlug="acme" profile={profile} />);
    const text = container.textContent ?? '';
    expect(text).toContain(pd.profileTitle);
    expect(text).toContain('ana@example.com');
    expect(text).toContain('Heredia');
    expect(text).toContain(pd.profileNotSet);
  });

  it('saves trimmed name, phone and location — never the email — then shows the new values', async () => {
    render(<DashboardProfile orgSlug="acme" profile={profile} />);
    fireEvent.click(screen.getByRole('button', { name: pd.profileEdit }));
    expect(screen.queryByRole('textbox', { name: pd.profileEmail })).toBeNull();
    fireEvent.change(screen.getByLabelText(pd.profilePhone), { target: { value: ' +506 8888 7777 ' } });
    fireEvent.change(screen.getByLabelText(pd.profileLocation), { target: { value: 'San José, Costa Rica' } });
    fireEvent.click(screen.getByRole('button', { name: pd.profileSave }));

    await waitFor(() => expect(mocks.profileMutate).toHaveBeenCalledTimes(1));
    expect(mocks.profileMutate).toHaveBeenCalledWith({
      orgSlug: 'acme',
      firstName: 'Ana',
      lastName: 'Gómez',
      phone: '+506 8888 7777',
      location: 'San José, Costa Rica',
    });

    mocks.profileOptions.onSuccess?.({
      firstName: 'Ana',
      lastName: 'Gómez',
      phone: '+506 8888 7777',
      location: 'San José, Costa Rica',
    });
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('+506 8888 7777')).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('refuses an invalid phone and an empty name with candidate-facing messages', async () => {
    render(<DashboardProfile orgSlug="acme" profile={profile} />);
    fireEvent.click(screen.getByRole('button', { name: pd.profileEdit }));
    fireEvent.change(screen.getByLabelText(pd.profilePhone), { target: { value: 'llámeme' } });
    fireEvent.change(screen.getByLabelText(`${pd.profileFirstName} *`), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: pd.profileSave }));

    const alerts = await screen.findAllByRole('alert');
    const text = alerts.map((a) => a.textContent).join(' ');
    expect(text).toContain(pd.profilePhoneInvalid);
    expect(text).toContain(pd.profileNameRequired);
    expect(mocks.profileMutate).not.toHaveBeenCalled();
  });

  it('a failed save keeps the form open and says so', async () => {
    render(<DashboardProfile orgSlug="acme" profile={profile} />);
    fireEvent.click(screen.getByRole('button', { name: pd.profileEdit }));
    mocks.profileOptions.onError?.(new Error('boom'));
    expect(mocks.toast).toHaveBeenCalledWith(pd.profileError, { type: 'error' });
    expect(screen.getByRole('button', { name: pd.profileSave })).toBeTruthy();
  });
});
