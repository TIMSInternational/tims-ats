import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({ applicationId: 'a1' })),
  invalidate: vi.fn(async () => undefined),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ orgSlug: 'acme' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ portal: { getVacancy: { invalidate: mocks.invalidate } } }),
    portal: { applyToVacancy: { useMutation: () => ({ mutateAsync: mocks.mutateAsync }) } },
  },
}));
vi.mock('../../apps/web/components', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../apps/web/components/turnstile-widget', () => ({ TurnstileWidget: () => null }));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/use-cv-upload', () => ({
  useCvUpload: () => ({
    file: null,
    error: null,
    uploading: false,
    handleFileChange: vi.fn(),
    removeFile: vi.fn(),
    uploadCvIfNeeded: async () => ({}),
  }),
}));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step2', () => ({
  ApplyModalStep2: () => null,
}));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step1', () => ({
  ApplyModalStep1: (props: {
    setFirstName: (v: string) => void;
    setLastName: (v: string) => void;
    setEmail: (v: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        props.setFirstName('Ana');
        props.setLastName('Pérez');
        props.setEmail('ana@example.com');
      }}
    >
      fill
    </button>
  ),
}));

import { ApplyModal } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal';

const VACANCY_ID = '11111111-1111-4111-8111-111111111111';

describe('apply modal', () => {
  it('refetches the vacancy after a successful application so the applicant count is current', async () => {
    render(
      <ApplyModal
        vacancyId={VACANCY_ID}
        vacancyTitle="Analyst"
        companyName="Acme"
        controllerName="Acme"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'fill' }));
    fireEvent.click(screen.getByRole('button', { name: en.portal.nextStep }));
    fireEvent.click(screen.getByRole('button', { name: en.portal.nextStep }));
    // Explicit data-processing consent is required before the application can be submitted.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: en.portal.submitApplication }));

    await waitFor(() => expect(screen.getByText(en.portal.applicationSentTitle)).toBeInTheDocument());
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledWith({ id: VACANCY_ID });
  });
});
