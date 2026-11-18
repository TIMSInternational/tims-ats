import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// The add-candidate submit tells two failures apart: "this email exists but the candidate could not be found"
// and "this candidate is already applying". It must branch on the error itself, never on message text, because
// a translated message can contain "already" (the en copy once did, and showed the wrong toast).

const m = vi.hoisted(() => ({
  t: null as unknown,
  toast: vi.fn(),
  create: vi.fn(),
  apply: vi.fn(),
  search: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useI18n: () => ({ t: m.t, locale: 'EN' }),
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => m.toast(...args) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ candidate: { search: { fetch: m.search } } }),
    candidate: {
      create: { useMutation: () => ({ mutateAsync: m.create }) },
      applyToVacancy: { useMutation: () => ({ mutateAsync: m.apply }) },
    },
  },
}));

import { AddCandidateModal } from '../../apps/web/app/(admin)/recruitment/pipeline/add-candidate-modal';

const p = en.pipeline;

function fillAndSubmit() {
  render(<AddCandidateModal vacancyId="v1" vacancyTitle="Analyst" onClose={vi.fn()} onSuccess={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(new RegExp(en.candidates.formFirstName)), { target: { value: 'Ana' } });
  fireEvent.change(screen.getByLabelText(new RegExp(en.candidates.formLastName)), { target: { value: 'Mora' } });
  fireEvent.change(screen.getByLabelText(new RegExp(`^${en.candidates.email}`)), {
    target: { value: 'ana@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: p.addCandidateNext }));
  fireEvent.click(screen.getByRole('button', { name: p.addCandidateNext }));
  fireEvent.click(screen.getByRole('button', { name: p.addCandidateSubmit }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.t = en;
  m.create.mockRejectedValue(new Error('Unique constraint failed on the fields: (`email`)'));
  m.search.mockResolvedValue([]);
});

describe('add candidate modal — error toasts (en locale)', () => {
  it('reports an existing email whose candidate cannot be found, not "already applying"', async () => {
    fillAndSubmit();
    await waitFor(() => expect(m.toast).toHaveBeenCalledTimes(1));
    expect(m.toast).toHaveBeenCalledWith(p.addCandidateExistsNotFound, { type: 'error' });
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('keeps the not-found toast even when its translated text contains "already"', async () => {
    const worded = "A candidate with this email already exists, but couldn't be found";
    m.t = { ...en, pipeline: { ...en.pipeline, addCandidateExistsNotFound: worded } };
    fillAndSubmit();
    await waitFor(() => expect(m.toast).toHaveBeenCalledTimes(1));
    expect(m.toast).toHaveBeenCalledWith(worded, { type: 'error' });
  });

  it('still says "already applying" when the application itself is a duplicate', async () => {
    m.search.mockResolvedValue([{ id: 'cand-1' }]);
    m.apply.mockRejectedValue(new Error('Candidate already applied to this vacancy'));
    fillAndSubmit();
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(p.alreadyApplying, { type: 'error' }));
  });
});
