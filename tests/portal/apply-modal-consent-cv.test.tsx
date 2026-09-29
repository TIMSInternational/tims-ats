import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { APPLICATION_CONSENT_TEXT_VERSION } from '../../packages/shared/src/constants/application-consent';

// F14 (explicit consent) + F5 UX (CV upload failures must be visible and recoverable)
// on the public apply modal.

const mocks = vi.hoisted(() => ({
  applyMutateAsync: vi.fn(),
  presignMutateAsync: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('next/navigation', () => ({ useParams: () => ({ orgSlug: 'acme' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    portal: {
      applyToVacancy: { useMutation: () => ({ mutateAsync: mocks.applyMutateAsync }) },
      getCvUploadUrl: { useMutation: () => ({ mutateAsync: mocks.presignMutateAsync }) },
    },
  },
}));
vi.mock('../../apps/web/components', () => ({
  Modal: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));
vi.mock('../../apps/web/components/turnstile-widget', () => ({ TurnstileWidget: () => null }));

import { ApplyModal } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal';

const VACANCY_ID = '11111111-1111-4111-8111-111111111111';
const p = en.portal;

// The vacancy's client company deliberately differs from the organization (tenant): the
// consent must name the ORGANIZATION, the data controller the privacy notice also names.
function renderModal() {
  return render(
    <ApplyModal
      vacancyId={VACANCY_ID}
      vacancyTitle="Backend Engineer"
      companyName="Cliente Industrial SA"
      controllerName="Acme SAS"
      onClose={vi.fn()}
    />,
  );
}

function fillStep1() {
  const inputs = screen.getAllByRole('textbox');
  // Step 1 order: first name, last name, email, phone, location.
  fireEvent.change(inputs[0]!, { target: { value: 'Ana' } });
  fireEvent.change(inputs[1]!, { target: { value: 'Gomez' } });
  fireEvent.change(inputs[2]!, { target: { value: 'ana@example.com' } });
}

function attachCv(container: HTMLElement, name = 'resume.pdf', bytes = 2048) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
}

function goToReview(opts: { withCv?: boolean } = {}) {
  const view = renderModal();
  fillStep1();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(p.applyNext) }));
  if (opts.withCv) attachCv(view.container);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(p.applyNext) }));
  return view;
}

const submitButton = () => screen.getByRole('button', { name: p.submitApplication });
const consentBox = () => screen.getByRole('checkbox');

beforeEach(() => {
  mocks.applyMutateAsync.mockReset().mockResolvedValue({ received: true });
  mocks.presignMutateAsync.mockReset().mockResolvedValue({
    url: 'https://bucket.s3.amazonaws.com',
    fields: { key: 'cv-uploads/org/x.pdf' },
    key: 'cv-uploads/org/x.pdf',
  });
  mocks.toast.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apply modal — explicit consent (F14)', () => {
  it('renders an UNCHECKED consent checkbox naming the org, purpose and a policy link; submit is disabled until checked', () => {
    goToReview();

    expect(consentBox()).not.toBeChecked();
    expect(submitButton()).toBeDisabled();
    const label = consentBox().closest('label')!;
    expect(label).toHaveTextContent('Acme SAS');
    expect(label).not.toHaveTextContent('Cliente Industrial SA');
    expect(label).toHaveTextContent(p.consentCheckboxMiddle);
    const link = screen.getByRole('link', { name: p.consentPolicyLink });
    expect(link).toHaveAttribute('href', '/careers/acme/privacy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(p.consentRequiredHint)).toBeInTheDocument();

    fireEvent.click(consentBox());
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByText(p.consentRequiredHint)).not.toBeInTheDocument();
  });

  it('never submits without consent, and sends consentAccepted + the current text version once checked', async () => {
    goToReview();

    fireEvent.click(submitButton());
    expect(mocks.applyMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(consentBox());
    fireEvent.click(submitButton());

    await waitFor(() => expect(mocks.applyMutateAsync).toHaveBeenCalledOnce());
    expect(mocks.applyMutateAsync.mock.calls[0]![0]).toMatchObject({
      vacancyId: VACANCY_ID,
      consentAccepted: true,
      consentTextVersion: APPLICATION_CONSENT_TEXT_VERSION,
    });
    expect(await screen.findByText(p.applicationSentTitle)).toBeInTheDocument();
  });
});

describe('apply modal — CV on the review step (F5 UX)', () => {
  it('lists the attached CV with its name and size', () => {
    goToReview({ withCv: true });
    expect(screen.getByText('resume.pdf (2 KB)')).toBeInTheDocument();
  });

  it('shows an inline error with retry / remove-and-continue when the presign call fails, and does not apply', async () => {
    mocks.presignMutateAsync.mockRejectedValue(new Error('presign 500'));
    goToReview({ withCv: true });
    fireEvent.click(consentBox());
    fireEvent.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(p.cvUploadFailedTitle);
    expect(mocks.applyMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: p.cvRetryUpload })).toBeEnabled();
    expect(submitButton()).toBeDisabled();
  });

  it('shows the same inline error when the S3 POST is blocked (fetch rejects), and retry re-attempts the upload', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    goToReview({ withCv: true });
    fireEvent.click(consentBox());
    fireEvent.click(submitButton());

    await screen.findByRole('alert');
    expect(mocks.applyMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: p.cvRetryUpload }));
    });

    await waitFor(() => expect(mocks.applyMutateAsync).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.applyMutateAsync.mock.calls[0]![0]).toMatchObject({
      cvFileKey: 'cv-uploads/org/x.pdf',
      cvFileName: 'resume.pdf',
    });
  });

  it('"remove CV and continue" submits the application without the CV', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));
    goToReview({ withCv: true });
    fireEvent.click(consentBox());
    fireEvent.click(submitButton());
    await screen.findByRole('alert');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: p.cvRemoveAndContinue }));
    });

    await waitFor(() => expect(mocks.applyMutateAsync).toHaveBeenCalledOnce());
    const sent = mocks.applyMutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.cvFileKey).toBeUndefined();
    expect(sent.cvFileName).toBeUndefined();
    expect(sent.consentAccepted).toBe(true);
    expect(mocks.presignMutateAsync).toHaveBeenCalledOnce();
  });
});
