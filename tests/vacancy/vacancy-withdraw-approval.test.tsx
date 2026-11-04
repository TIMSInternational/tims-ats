import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Pilot UX re-audit (company-admin access-1 / journeys-18): a vacancy stuck in "pending approval"
// because the approver is away can be taken back by whoever may submit it, after a confirmation.

const VACANCY = '77777777-7777-4777-8777-777777777777';
const m = vi.hoisted(() => ({
  withdraw: vi.fn(),
  grants: new Set<string>(),
  userId: 'me',
}));
const idle = vi.hoisted(() => () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({ can: (mod: string, action = 'read') => m.grants.has(`${mod}:${action}`), userId: m.userId }),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ vacancy: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
    vacancy: {
      submitForApproval: { useMutation: idle },
      approve: { useMutation: idle },
      reject: { useMutation: idle },
      withdrawApproval: { useMutation: () => ({ ...idle(), mutate: m.withdraw }) },
    },
  },
}));
vi.mock('../../apps/web/app/(admin)/recruitment/vacancies/[id]/submit-approval-modal', () => ({
  SubmitApprovalModal: () => null,
}));

import { ApprovalChain } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/approval-chain';

const approval = (approverId: string) => ({
  id: `a-${approverId}`,
  step: 1,
  status: 'pending',
  comment: null,
  decidedAt: null,
  approver: { id: approverId, firstName: 'Ana', lastName: 'Approver', avatar: null },
});

beforeEach(() => {
  m.withdraw.mockReset();
  m.grants = new Set(['vacancy:read', 'vacancy:update']);
  m.userId = 'me';
});

describe('vacancy approval chain — withdraw a pending request', () => {
  it('the submitter withdraws only after confirming in a dialog', () => {
    render(<ApprovalChain vacancyId={VACANCY} vacancyStatus="pending_approval" approvals={[approval('other')]} />);
    fireEvent.click(screen.getByRole('button', { name: en.vacancies.withdrawApproval }));
    expect(m.withdraw).not.toHaveBeenCalled();
    expect(screen.getByText(en.vacancies.withdrawApprovalDesc)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.vacancies.withdrawApprovalConfirm }));
    expect(m.withdraw).toHaveBeenCalledWith({ id: VACANCY });
  });

  it('is not offered without vacancy:update, on a non-pending vacancy, or to the pending approver', () => {
    m.grants = new Set(['vacancy:read', 'vacancy:approve']);
    const { unmount } = render(
      <ApprovalChain vacancyId={VACANCY} vacancyStatus="pending_approval" approvals={[approval('other')]} />,
    );
    expect(screen.queryByRole('button', { name: en.vacancies.withdrawApproval })).toBeNull();
    unmount();

    m.grants = new Set(['vacancy:read', 'vacancy:update']);
    const approved = render(
      <ApprovalChain vacancyId={VACANCY} vacancyStatus="approved" approvals={[approval('other')]} />,
    );
    expect(screen.queryByRole('button', { name: en.vacancies.withdrawApproval })).toBeNull();
    approved.unmount();

    // The viewer's own pending step shows Approve / Reject instead.
    render(<ApprovalChain vacancyId={VACANCY} vacancyStatus="pending_approval" approvals={[approval('me')]} />);
    expect(screen.queryByRole('button', { name: en.vacancies.withdrawApproval })).toBeNull();
    expect(screen.getByRole('button', { name: en.vacancies.approveStep })).toBeInTheDocument();
  });
});
