import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Regression (Codex review): the apply modal must hand the REAL Modal a stable onClose. Modal re-runs its
// focus effect whenever onClose changes identity, so a new callback per keystroke pulled focus out of the
// field after every character typed.

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ orgSlug: 'acme' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ portal: { getVacancy: { invalidate: async () => undefined } } }),
    portal: {
      applyToVacancy: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      getCvUploadUrl: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
vi.mock('../../apps/web/components', async () => ({
  Modal: (await import('../../apps/web/components/modal')).Modal,
}));
vi.mock('../../apps/web/components/turnstile-widget', () => ({ TurnstileWidget: () => null }));

import { ApplyModal } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

describe('apply modal focus', () => {
  it('keeps focus in the field being typed in', async () => {
    render(
      <ApplyModal vacancyId="11111111-1111-4111-8111-111111111111" vacancyTitle="Analista" companyName="Acme" controllerName="Acme" onClose={vi.fn()} />,
    );
    await flush();
    const firstName = screen.getByLabelText(en.portal.firstNameLabel);
    firstName.focus();
    for (const value of ['A', 'An', 'Ana']) {
      fireEvent.change(firstName, { target: { value } });
      await flush();
      expect(document.activeElement).toBe(firstName);
    }
  });
});
