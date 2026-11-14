import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Pilot UX re-audit (company-admin access-1 / journeys-18): a vacancy stuck in "pending approval"
// because the approver is away can be taken back by whoever may submit it, after a confirmation.

const VACANCY = '77777777-7777-4777-8777-777777777777';
const m = vi.hoisted(() => ({
  withdraw: vi.fn(),
  reject: vi.fn(),
  grants: new Set<string>(),
  userId: 'me',
}));
const idle = vi.hoisted(() => () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }));

// The pure message helpers (formatMessage, pluralize) stay real; only the locale hook is fixed.
vi.mock('../../apps/web/lib/i18n', async () => ({
  ...(await vi.importActual<typeof import('../../apps/web/lib/i18n/format')>('../../apps/web/lib/i18n/format')),
  useI18n: () => ({ t: en, locale: 'EN' }),
}));
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
      reject: { useMutation: () => ({ ...idle(), mutate: m.reject }) },
      withdrawApproval: { useMutation: () => ({ ...idle(), mutate: m.withdraw }) },
    },
  },
}));
vi.mock('../../apps/web/app/(admin)/recruitment/vacancies/[id]/submit-approval-modal', () => ({
  SubmitApprovalModal: () => null,
}));

import { ApprovalChain } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/approval-chain';
// The approver decides in the callout at the top of the detail page (it moved out of the chain card).
import { ApprovalDecisionCallout } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/approval-decision-callout';

const confirmInDialog = (name: string) =>
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));

const approval = (approverId: string, id = `a-${approverId}`, status = 'pending') => ({
  id,
  step: 1,
  status,
  comment: null,
  decidedAt: null,
  approver: { id: approverId, firstName: 'Ana', lastName: 'Approver', avatar: null },
});

beforeEach(() => {
  m.withdraw.mockReset();
  m.reject.mockReset();
  m.grants = new Set(['vacancy:read', 'vacancy:update']);
  m.userId = 'me';
});

describe('vacancy approval chain — withdraw a pending request', () => {
  it('the submitter withdraws only after confirming in a dialog', () => {
    render(<ApprovalChain vacancyId={VACANCY} vacancyStatus="pending_approval" approvals={[approval('other')]} />);
    fireEvent.click(screen.getByRole('button', { name: en.vacancies.withdrawApproval }));
    expect(m.withdraw).not.toHaveBeenCalled();
    expect(screen.getByText(en.vacancies.withdrawApprovalDesc)).toBeInTheDocument();
    confirmInDialog(en.vacancies.withdrawApprovalConfirm);
    expect(m.withdraw).toHaveBeenCalledWith({ id: VACANCY, approvalId: 'a-other' });
  });

  it('is not offered without vacancy:update or on a non-pending vacancy', () => {
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

    // An approver without vacancy:update decides; they cannot withdraw.
    m.grants = new Set(['vacancy:read', 'vacancy:approve']);
    render(
      <>
        <ApprovalDecisionCallout vacancyId={VACANCY} approvals={[approval('me')]} />
        <ApprovalChain vacancyId={VACANCY} vacancyStatus="pending_approval" approvals={[approval('me')]} />
      </>,
    );
    expect(screen.queryByRole('button', { name: en.vacancies.withdrawApproval })).toBeNull();
    expect(screen.getByRole('button', { name: en.vacancies.approveStep })).toBeInTheDocument();
  });

  // Codex P2: a submitter who is also one of the approvers can take the request back without deciding
  // their own step first.
  it('a submitter who is also a pending approver can withdraw as well as decide', () => {
    m.grants = new Set(['vacancy:read', 'vacancy:update', 'vacancy:approve']);
    const approvals = [approval('me'), approval('away', 'a-away')];
    render(
      <>
        <ApprovalDecisionCallout vacancyId={VACANCY} approvals={approvals} />
        <ApprovalChain vacancyId={VACANCY} vacancyStatus="pending_approval" approvals={approvals} />
      </>,
    );
    expect(screen.getByRole('button', { name: en.vacancies.approveStep })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.vacancies.withdrawApproval }));
    confirmInDialog(en.vacancies.withdrawApprovalConfirm);
    expect(m.withdraw).toHaveBeenCalledWith({ id: VACANCY, approvalId: 'a-me' });
  });

  it('an open withdraw dialog closes by itself when a refetch shows a different request', () => {
    const view = render(
      <ApprovalChain vacancyId={VACANCY} vacancyStatus="pending_approval" approvals={[approval('other')]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: en.vacancies.withdrawApproval }));
    expect(screen.getByText(en.vacancies.withdrawApprovalDesc)).toBeInTheDocument();
    view.rerender(
      <ApprovalChain
        vacancyId={VACANCY}
        vacancyStatus="pending_approval"
        approvals={[approval('other', 'a-other', 'cancelled'), approval('other', 'a-other-2')]}
      />,
    );
    expect(screen.queryByText(en.vacancies.withdrawApprovalDesc)).toBeNull();
    expect(m.withdraw).not.toHaveBeenCalled();
  });
});

// Codex P1: a reject dialog opened for one request must never be sent against a resubmitted request.
describe('vacancy approval decision — reject dialog is bound to its step', () => {
  beforeEach(() => {
    m.grants = new Set(['vacancy:read', 'vacancy:approve']);
  });

  it('sends the reason for the step the dialog was opened on', () => {
    render(<ApprovalDecisionCallout vacancyId={VACANCY} approvals={[approval('me')]} />);
    fireEvent.click(screen.getByRole('button', { name: en.vacancies.rejectStepEllipsis }));
    fireEvent.change(screen.getByPlaceholderText(en.vacancies.rejectReasonPlaceholder), {
      target: { value: 'Sin presupuesto' },
    });
    confirmInDialog(en.vacancies.rejectVacancyConfirm);
    expect(m.reject).toHaveBeenCalledWith({ id: VACANCY, approvalId: 'a-me', comment: 'Sin presupuesto' });
  });

  it('closes when a refetch shows the request withdrawn and resubmitted', () => {
    const view = render(<ApprovalDecisionCallout vacancyId={VACANCY} approvals={[approval('me')]} />);
    fireEvent.click(screen.getByRole('button', { name: en.vacancies.rejectStepEllipsis }));
    expect(screen.getByText(en.vacancies.rejectConfirmDesc)).toBeInTheDocument();
    view.rerender(
      <ApprovalDecisionCallout
        vacancyId={VACANCY}
        approvals={[approval('me', 'a-me', 'cancelled'), approval('me', 'a-me-2')]}
      />,
    );
    expect(screen.queryByText(en.vacancies.rejectConfirmDesc)).toBeNull();
    expect(m.reject).not.toHaveBeenCalled();
  });
});
