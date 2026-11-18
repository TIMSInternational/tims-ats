/**
 * Platform ops feedback in the UI:
 * - a failed feature-flag toggle shows the error toast (frontend.md: onError toast on every mutation)
 *   and keeps the inline per-row error;
 * - the access-review attest modal's footer "Cancelar" goes through the dirty guard, like ✕ and Escape.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

type MutationOpts = {
  onError?: (err: Error, vars: { organizationId: string; key: string; enabled: boolean }) => void;
};

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  updateFlagOpts: { current: null as MutationOpts | null },
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const actual = await vi.importActual<typeof import('../../apps/web/lib/i18n')>('../../apps/web/lib/i18n');
  return { ...actual, useI18n: () => ({ t: es, locale: 'ES' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: m.toast }));
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock('../../apps/web/lib/platform-api/access-review', () => ({
  useAccessReviewAttest: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../apps/web/lib/trpc', () => {
  const idle = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  return {
    trpc: {
      useUtils: () => ({ platform: { listAllFeatureFlags: { invalidate: vi.fn() } } }),
      platform: {
        listAllFeatureFlags: {
          useQuery: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
        },
        updateFeatureFlag: {
          useMutation: (opts: MutationOpts) => {
            m.updateFlagOpts.current = opts;
            return { mutate: vi.fn(), isPending: false };
          },
        },
        seedFeatureFlags: idle,
        createFeatureFlagForAllOrgs: idle,
        deleteFeatureFlagByKey: idle,
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  m.updateFlagOpts.current = null;
});

describe('feature flags → toggle failure', () => {
  it('shows the error as a toast', async () => {
    const { default: Page } = await import('../../apps/web/app/(admin)/platform/feature-flags/page');
    render(<Page />);
    expect(m.updateFlagOpts.current?.onError).toBeTypeOf('function');
    act(() => {
      m.updateFlagOpts.current!.onError!(new Error('No se pudo guardar'), {
        organizationId: 'o1',
        key: 'recruitment',
        enabled: true,
      });
    });
    expect(m.toast).toHaveBeenCalledWith('No se pudo guardar', { type: 'error' });
  });
});

describe('access review → attest modal', () => {
  it('footer Cancelar asks before discarding typed notes', async () => {
    const { AttestModal } = await import('../../apps/web/app/(admin)/platform/access-review/attest-modal');
    const onClose = vi.fn();
    render(<AttestModal organizationId="o1" onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Revisado con RR. HH.' } });
    fireEvent.click(screen.getByRole('button', { name: es.common.cancel }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('footer Cancelar closes at once when nothing was typed', async () => {
    const { AttestModal } = await import('../../apps/web/app/(admin)/platform/access-review/attest-modal');
    const onClose = vi.fn();
    render(<AttestModal organizationId="o1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: es.common.cancel }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
