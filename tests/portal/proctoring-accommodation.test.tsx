import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import en from '../../apps/web/lib/i18n/en.json';

const { mutate, invalidate, capability } = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  capability: { enabled: true },
}));
let canWrite = true;
vi.mock('../../apps/web/lib/proctoring/staff-access', () => ({
  useProctoringStaffAccess: () => ({ canRead: true, canWrite, isLoading: false }),
}));

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { useUtils: () => ({ candidate: { getById: { invalidate } } }) },
}));
vi.mock('../../apps/web/lib/platform-api/proctoring', () => ({
  useProctoringCapability: () => ({ data: { enabled: capability.enabled } }),
}));
vi.mock('../../apps/web/lib/platform-api/proctoring-staff', () => ({
  useGrantProctoringAccommodation: () => ({ mutate, isPending: false, isError: false }),
}));

import { ProctoringAccommodation } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/proctoring-accommodation';

describe('pre-start proctoring accommodation', () => {
  beforeEach(() => {
    localStorage.setItem('tims-locale', 'EN');
    capability.enabled = true;
    canWrite = true;
    mutate.mockReset();
    invalidate.mockReset();
  });

  it('records a fixed reason category and refreshes the assignment after success', () => {
    render(<I18nProvider><ProctoringAccommodation assignmentId="11111111-1111-4111-8111-111111111111" /></I18nProvider>);
    fireEvent.change(screen.getByRole('combobox', { name: en.proctoring.accommodation.reason }), {
      target: { value: 'accessibility' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.accommodation.allowWithoutMonitoring }));
    expect(mutate).toHaveBeenCalledWith(
      { assignmentId: '11111111-1111-4111-8111-111111111111', reason: 'accessibility' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const callbacks = mutate.mock.calls[0][1] as { onSuccess: () => void };
    callbacks.onSuccess();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('hides the action when the C# feature is disabled', () => {
    capability.enabled = false;
    render(<I18nProvider><ProctoringAccommodation assignmentId="11111111-1111-4111-8111-111111111111" /></I18nProvider>);
    expect(screen.queryByRole('button', { name: en.proctoring.accommodation.allowWithoutMonitoring })).not.toBeInTheDocument();
  });

  it('hides the action from read-only HR staff', () => {
    canWrite = false;
    render(<I18nProvider><ProctoringAccommodation assignmentId="11111111-1111-4111-8111-111111111111" /></I18nProvider>);
    expect(screen.queryByRole('button', { name: en.proctoring.accommodation.allowWithoutMonitoring })).not.toBeInTheDocument();
  });
});
