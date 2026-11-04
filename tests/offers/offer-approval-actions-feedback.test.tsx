import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Pilot UX audit B-13 / B-32 and the stuck-approval unblock (company-admin access-1 / journeys-18):
//  - every approval action confirms what happened with a toast;
//  - approve and reject are deliberate second steps, and the reason box only appears for reject;
//  - the card is titled by what the viewer can do ("Your decision" / "Request approval"), not a
//    second "Offer approval chain";
//  - the requester can withdraw a pending request (with a confirmation) and send it to someone else.

const OFFER_ID = '99999999-9999-4999-8999-999999999999';
const ME = 'me-1';

const m = vi.hoisted(() => ({
  submit: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  withdraw: vi.fn(),
  toast: vi.fn(),
  grants: new Set<string>(),
}));
const mutation = (mutateAsync: () => Promise<unknown>) => ({ mutateAsync, isPending: false });

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: m.toast }));
vi.mock('../../apps/web/lib/permissions', () => ({
  useCan:
    () =>
    (module: string, action = 'read') =>
      m.grants.has(`${module}:${action}`),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    user: { me: { useQuery: () => ({ data: { id: ME }, isLoading: false }) } },
    offer: {
      submitForApproval: { useMutation: () => mutation(m.submit) },
      approve: { useMutation: () => mutation(m.approve) },
      reject: { useMutation: () => mutation(m.reject) },
      withdrawApproval: { useMutation: () => mutation(m.withdraw) },
    },
  },
}));
vi.mock('../../apps/web/components/user-picker', () => ({
  UserPicker: ({ onSelect }: { onSelect: (id: string, user: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect('u1', { id: 'u1', firstName: 'Ana', lastName: 'Leader', email: 'a@x.test', avatarUrl: null })
      }
    >
      pick-ana
    </button>
  ),
}));

import { OfferApprovalActions } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-approval-actions';

const MY_TURN = [{ id: 'step-me', approver: { id: ME }, status: 'pending' }];
const SOMEONE_ELSES_TURN = [
  { id: 'step-old', approver: { id: 'other' }, status: 'cancelled' },
  { id: 'step-live', approver: { id: 'other' }, status: 'pending' },
];
const button = (name: string) => screen.getByRole('button', { name });

type Step = { id: string; approver: { id: string }; status: string };

function renderActions(status: string, approvals: Step[]) {
  const onUpdated = vi.fn();
  render(<OfferApprovalActions offerId={OFFER_ID} status={status} approvals={approvals} onUpdated={onUpdated} />);
  return onUpdated;
}

/** Render, and return a function that re-renders with a refetched approval chain. */
function renderRefetchable(status: string, approvals: Step[]) {
  const onUpdated = vi.fn();
  const view = render(
    <OfferApprovalActions offerId={OFFER_ID} status={status} approvals={approvals} onUpdated={onUpdated} />,
  );
  const refetched = (next: Step[]) =>
    view.rerender(<OfferApprovalActions offerId={OFFER_ID} status={status} approvals={next} onUpdated={onUpdated} />);
  return { onUpdated, refetched };
}

const conflict = () => Object.assign(new Error('La oferta ya no está pendiente'), { data: { code: 'CONFLICT' } });

beforeEach(() => {
  for (const fn of [m.submit, m.approve, m.reject, m.withdraw, m.toast]) fn.mockReset();
  m.grants = new Set(['offer:read', 'offer:approve']);
});

describe('approver: "Your decision"', () => {
  it('is titled by the decision, and the reason box is hidden until "Reject" is chosen', () => {
    renderActions('pending_approval', MY_TURN);
    expect(screen.getByRole('heading', { name: en.offers.yourDecision })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.offers.approvalChain })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('approve needs a confirmation, sends the optional comment, and says the offer can now be sent', async () => {
    m.approve.mockResolvedValue({ id: OFFER_ID, status: 'approved' });
    const onUpdated = renderActions('pending_approval', MY_TURN);

    fireEvent.click(button(en.offers.approve));
    expect(m.approve).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: en.offers.approvalCommentOptional }), {
      target: { value: ' Within budget ' },
    });
    fireEvent.click(button(en.offers.approveConfirm));

    // The decision names the step the approver saw (stale-tab guard).
    await waitFor(() =>
      expect(m.approve).toHaveBeenCalledWith({ id: OFFER_ID, approvalId: 'step-me', comment: 'Within budget' }),
    );
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(en.offers.approvalRecordedFinal, { type: 'success' }));
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it('a non-final approval says other approvals are still pending', async () => {
    m.approve.mockResolvedValue({ id: OFFER_ID, status: 'pending_approval' });
    renderActions('pending_approval', MY_TURN);
    fireEvent.click(button(en.offers.approve));
    fireEvent.click(button(en.offers.approveConfirm));
    await waitFor(() => expect(m.approve).toHaveBeenCalledWith({ id: OFFER_ID, approvalId: 'step-me' }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(en.offers.approvalRecordedPartial, { type: 'success' }));
  });

  it('reject requires a reason and confirms the rejection', async () => {
    m.reject.mockResolvedValue({ id: OFFER_ID, status: 'rejected' });
    renderActions('pending_approval', MY_TURN);

    fireEvent.click(button(en.offers.reject));
    expect(button(en.offers.rejectConfirm)).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: `${en.offers.rejectionReason} *` }), {
      target: { value: 'Over budget' },
    });
    fireEvent.click(button(en.offers.rejectConfirm));

    await waitFor(() =>
      expect(m.reject).toHaveBeenCalledWith({ id: OFFER_ID, approvalId: 'step-me', comment: 'Over budget' }),
    );
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(en.offers.offerRejectedToast, { type: 'success' }));
  });

  it('cancel backs out of a decision without calling the server', () => {
    renderActions('pending_approval', MY_TURN);
    fireEvent.click(button(en.offers.reject));
    fireEvent.click(button(en.common.cancel));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(m.reject).not.toHaveBeenCalled();
  });

  // Codex P1: a confirmation left open after a conflict must never be re-sent against a resubmitted
  // request (new step id) carrying the comment written for the old one.
  it('a conflict closes the open confirmation; the resubmitted request needs a fresh decision', async () => {
    m.approve.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ id: OFFER_ID, status: 'approved' });
    const { onUpdated, refetched } = renderRefetchable('pending_approval', MY_TURN);

    fireEvent.click(button(en.offers.approve));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OK for the old terms' } });
    fireEvent.click(button(en.offers.approveConfirm));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('textbox')).toBeNull();

    // The refetch shows the request withdrawn and resubmitted to the same approver.
    refetched([
      { id: 'step-me', approver: { id: ME }, status: 'cancelled' },
      { id: 'step-me-2', approver: { id: ME }, status: 'pending' },
    ]);
    expect(screen.queryByRole('button', { name: en.offers.approveConfirm })).toBeNull();
    fireEvent.click(button(en.offers.approve));
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.click(button(en.offers.approveConfirm));
    await waitFor(() => expect(m.approve).toHaveBeenLastCalledWith({ id: OFFER_ID, approvalId: 'step-me-2' }));
  });

  it('an open confirmation closes by itself when a refetch shows a different step', () => {
    const { refetched } = renderRefetchable('pending_approval', MY_TURN);
    fireEvent.click(button(en.offers.reject));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Over budget' } });
    refetched([{ id: 'step-me-2', approver: { id: ME }, status: 'pending' }]);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: en.offers.rejectConfirm })).toBeNull();
    expect(m.reject).not.toHaveBeenCalled();
  });

  // Codex P2: a requester who is also an approver can take the request back without deciding it first
  // (for an offer, rejecting would end it for good).
  it('a requester who is also the approver can withdraw instead of deciding', async () => {
    m.grants = new Set(['offer:read', 'offer:approve', 'offer:create']);
    m.withdraw.mockResolvedValue({ id: OFFER_ID, status: 'draft' });
    renderActions('pending_approval', MY_TURN);

    expect(button(en.offers.approve)).toBeInTheDocument();
    fireEvent.click(button(en.offers.withdrawApproval));
    expect(screen.queryByRole('button', { name: en.offers.approve })).toBeNull();
    fireEvent.click(button(en.offers.withdrawApprovalConfirm));
    await waitFor(() => expect(m.withdraw).toHaveBeenCalledWith({ id: OFFER_ID, approvalId: 'step-me' }));
    expect(m.approve).not.toHaveBeenCalled();
    expect(m.reject).not.toHaveBeenCalled();
  });

  it('an approver without the request grant is not offered withdrawal', () => {
    renderActions('pending_approval', MY_TURN);
    expect(screen.queryByRole('button', { name: en.offers.withdrawApproval })).toBeNull();
  });
});

describe('requester', () => {
  it('draft: titled "Request approval" and confirms who the request went to', async () => {
    m.grants = new Set(['offer:read', 'offer:create']);
    m.submit.mockResolvedValue({});
    renderActions('draft', []);
    expect(screen.getByRole('heading', { name: en.offers.requestApproval })).toBeInTheDocument();

    fireEvent.click(button('pick-ana'));
    fireEvent.click(button(en.offers.requestApproval));

    await waitFor(() => expect(m.submit).toHaveBeenCalledWith({ id: OFFER_ID, approverIds: ['u1'] }));
    await waitFor(() =>
      expect(m.toast).toHaveBeenCalledWith(en.offers.approvalRequestedTo.replace('{name}', 'Ana Leader'), {
        type: 'success',
      }),
    );
  });

  it('pending: can withdraw the request after confirming, and is told the offer is back in draft', async () => {
    m.grants = new Set(['offer:read', 'offer:create']);
    m.withdraw.mockResolvedValue({ id: OFFER_ID, status: 'draft' });
    const onUpdated = renderActions('pending_approval', SOMEONE_ELSES_TURN);

    expect(screen.getByRole('heading', { name: en.offers.approvalRequestTitle })).toBeInTheDocument();
    expect(screen.getByText(en.offers.awaitingApproverDecision)).toBeInTheDocument();
    fireEvent.click(button(en.offers.withdrawApproval));
    expect(m.withdraw).not.toHaveBeenCalled();
    expect(screen.getByText(en.offers.withdrawApprovalPrompt)).toBeInTheDocument();
    fireEvent.click(button(en.offers.withdrawApprovalConfirm));

    // Names the live request's pending step, not the cancelled one from an earlier round.
    await waitFor(() => expect(m.withdraw).toHaveBeenCalledWith({ id: OFFER_ID, approvalId: 'step-live' }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(en.offers.withdrawApprovalSuccess, { type: 'success' }));
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it('pending: an open withdrawal confirmation closes when a refetch shows a different request', () => {
    m.grants = new Set(['offer:read', 'offer:create']);
    const { refetched } = renderRefetchable('pending_approval', SOMEONE_ELSES_TURN);
    fireEvent.click(button(en.offers.withdrawApproval));
    expect(screen.getByText(en.offers.withdrawApprovalPrompt)).toBeInTheDocument();
    refetched([
      { id: 'step-live', approver: { id: 'other' }, status: 'cancelled' },
      { id: 'step-live-2', approver: { id: 'other' }, status: 'pending' },
    ]);
    expect(screen.queryByText(en.offers.withdrawApprovalPrompt)).toBeNull();
    expect(screen.queryByRole('button', { name: en.offers.withdrawApprovalConfirm })).toBeNull();
    expect(m.withdraw).not.toHaveBeenCalled();
  });
});

it('shows no request form on a draft to a viewer who cannot request approval (Codex P2)', () => {
  m.grants = new Set(['offer:read', 'offer:approve']);
  const { container } = render(
    <OfferApprovalActions offerId={OFFER_ID} status="draft" approvals={[]} onUpdated={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it('renders no empty card for a viewer who can neither decide nor withdraw', () => {
  m.grants = new Set(['offer:read']);
  const { container } = render(
    <OfferApprovalActions
      offerId={OFFER_ID}
      status="pending_approval"
      approvals={SOMEONE_ELSES_TURN}
      onUpdated={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});
