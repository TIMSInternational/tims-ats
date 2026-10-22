import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// #315 fix round 1: candidate.create now refuses a canonical-email duplicate with a tRPC
// CONFLICT ("Ya existe un candidato con este email") before the insert. The pipeline
// "Add candidate" modal must still reuse the existing candidate and apply them to the vacancy.

const createMutateAsync = vi.fn();
const applyMutateAsync = vi.fn();
const searchFetch = vi.fn();
const toastMock = vi.fn();

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidate: {
      create: { useMutation: () => ({ mutateAsync: createMutateAsync }) },
      applyToVacancy: { useMutation: () => ({ mutateAsync: applyMutateAsync }) },
    },
    useUtils: () => ({ candidate: { search: { fetch: searchFetch } } }),
  },
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

import { AddCandidateModal } from '../../apps/web/app/(admin)/recruitment/pipeline/add-candidate-modal';
import {
  isDuplicateCandidateError,
  pickExistingCandidateId,
} from '../../apps/web/app/(admin)/recruitment/pipeline/add-candidate-modal.helpers';

const VACANCY = '11111111-1111-4111-8111-111111111111';
const EXISTING = '22222222-2222-4222-8222-222222222222';
const NEIGHBOUR = '33333333-3333-4333-8333-333333333333';

// Shape of a TRPCClientError for a server-side TRPCError({ code: 'CONFLICT' }).
function conflictError(): Error {
  return Object.assign(new Error('Ya existe un candidato con este email'), {
    data: { code: 'CONFLICT', httpStatus: 409 },
  });
}

async function submitWithEmail(email: string) {
  const onSuccess = vi.fn();
  const { container } = render(
    <AddCandidateModal vacancyId={VACANCY} vacancyTitle="Analista" onClose={vi.fn()} onSuccess={onSuccess} />,
  );
  const inputs = container.querySelectorAll('input');
  fireEvent.change(inputs[0], { target: { value: 'Ana' } });
  fireEvent.change(inputs[1], { target: { value: 'Lopez' } });
  fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: email } });
  fireEvent.click(screen.getByText('Siguiente'));
  fireEvent.click(screen.getByText('Siguiente'));
  fireEvent.click(screen.getByText('Agregar al Pipeline'));
  return onSuccess;
}

describe('AddCandidateModal — existing-candidate fallback (#315)', () => {
  beforeEach(() => {
    createMutateAsync.mockReset();
    applyMutateAsync.mockReset();
    searchFetch.mockReset();
    toastMock.mockReset();
  });

  it('reuses the existing candidate when create returns a tRPC CONFLICT', async () => {
    createMutateAsync.mockRejectedValueOnce(conflictError());
    // The search is a CONTAINS match: a more recently updated neighbour comes first.
    searchFetch.mockResolvedValueOnce([
      { id: NEIGHBOUR, email: 'juana@acme.test' },
      { id: EXISTING, email: 'Ana@Acme.test' },
    ]);
    applyMutateAsync.mockResolvedValueOnce({ id: 'app-1' });

    const onSuccess = await submitWithEmail('  ana@acme.test ');

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(applyMutateAsync).toHaveBeenCalledWith({ candidateId: EXISTING, vacancyId: VACANCY, source: 'manual' });
    expect(toastMock).not.toHaveBeenCalledWith(expect.anything(), { type: 'error' });
  });

  it('does not apply a different candidate when no row canonically matches', async () => {
    createMutateAsync.mockRejectedValueOnce(conflictError());
    searchFetch.mockResolvedValueOnce([{ id: NEIGHBOUR, email: 'juana@acme.test' }]);

    const onSuccess = await submitWithEmail('ana@acme.test');

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('Candidato con este email ya existe pero no se pudo encontrar', {
        type: 'error',
      }),
    );
    expect(applyMutateAsync).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('surfaces non-duplicate create errors without searching', async () => {
    createMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('Sin permiso'), { data: { code: 'FORBIDDEN', httpStatus: 403 } }),
    );

    await submitWithEmail('ana@acme.test');

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Sin permiso', { type: 'error' }));
    expect(searchFetch).not.toHaveBeenCalled();
    expect(applyMutateAsync).not.toHaveBeenCalled();
  });
});

describe('add-candidate-modal helpers (#315)', () => {
  it('isDuplicateCandidateError keys on the tRPC CONFLICT code and the legacy P2002 text', () => {
    expect(isDuplicateCandidateError(conflictError())).toBe(true);
    expect(
      isDuplicateCandidateError(new Error('Unique constraint failed on the fields: (`organization_id`,`email`)')),
    ).toBe(true);
    expect(isDuplicateCandidateError(Object.assign(new Error('x'), { data: { code: 'FORBIDDEN' } }))).toBe(false);
    expect(isDuplicateCandidateError(null)).toBe(false);
    expect(isDuplicateCandidateError('CONFLICT')).toBe(false);
  });

  it('pickExistingCandidateId matches canonically and never falls back to the first row', () => {
    const rows = [
      { id: NEIGHBOUR, email: 'juana@acme.test' },
      { id: EXISTING, email: ' ANA@acme.test' },
    ];
    expect(pickExistingCandidateId(rows, 'ana@ACME.test ')).toBe(EXISTING);
    expect(pickExistingCandidateId([rows[0]], 'ana@acme.test')).toBeNull();
    expect(pickExistingCandidateId(rows, '   ')).toBeNull();
    // Tier-1 review: with case-variant duplicates, the row stored canonically (the one the portal
    // resolves) wins over a more recently updated variant listed first.
    const dupes = [
      { id: 'upper-recent', email: 'ANA@acme.test' },
      { id: 'canonical', email: 'ana@acme.test' },
    ];
    expect(pickExistingCandidateId(dupes, ' Ana@ACME.test ')).toBe('canonical');
  });
});
