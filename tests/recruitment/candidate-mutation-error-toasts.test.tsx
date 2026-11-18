import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// frontend.md: every mutation toasts on error. Where the form stays open, the inline message stays too.

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  addOptions: {} as { onError?: () => void },
  addState: { error: null as Error | null },
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => m.toast(...args) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ candidate: { getById: { invalidate: vi.fn() } } }),
    candidate: {
      addTag: {
        useMutation: (options: { onError?: () => void }) => {
          m.addOptions = options;
          return { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: m.addState.error };
        },
      },
      removeTag: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { TagsCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/tags-card';
import { createErrorMessage } from '../../apps/web/app/(admin)/recruitment/candidates/create-modal.helpers';

beforeEach(() => {
  m.toast.mockReset();
  m.addState.error = null;
});

describe('tags card — a rejected tag', () => {
  it('toasts the error and labels the field inline', () => {
    m.addState.error = new Error('duplicate');
    render(<TagsCard tags={[]} candidateId="cand-1" />);
    m.addOptions.onError?.();
    expect(m.toast).toHaveBeenCalledWith(es.candidates.tagAddError, { type: 'error' });
    expect(screen.getByRole('alert').textContent).toBe(es.candidates.tagAddError);
    const input = screen.getByLabelText(es.candidates.newTagLabel);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('candidate create — the toast and the dialog say the same thing', () => {
  it('maps each tRPC code to its message', () => {
    const c = es.candidates;
    expect(createErrorMessage('CONFLICT', c)).toBe(c.emailTaken);
    expect(createErrorMessage('FORBIDDEN', c)).toBe(c.createErrorForbidden);
    expect(createErrorMessage('BAD_REQUEST', c)).toBe(c.createErrorInvalid);
    expect(createErrorMessage('INTERNAL_SERVER_ERROR', c)).toBe(c.createError);
    expect(createErrorMessage(undefined, c)).toBe(c.createError);
  });
});
