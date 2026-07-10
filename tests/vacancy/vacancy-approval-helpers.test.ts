import { describe, it, expect } from 'vitest';
import { canSubmitForApproval, findPendingApprovalForUser } from '../../apps/web/lib/vacancy-approval-helpers';

describe('canSubmitForApproval', () => {
  it('is true only when the vacancy is still a draft', () => {
    expect(canSubmitForApproval('draft')).toBe(true);
    expect(canSubmitForApproval('pending_approval')).toBe(false);
    expect(canSubmitForApproval('approved')).toBe(false);
    expect(canSubmitForApproval('published')).toBe(false);
    expect(canSubmitForApproval('closed')).toBe(false);
    expect(canSubmitForApproval('frozen')).toBe(false);
  });
});

describe('findPendingApprovalForUser', () => {
  const approvals = [
    { id: 'a1', status: 'approved', approver: { id: 'u1' } },
    { id: 'a2', status: 'pending', approver: { id: 'u2' } },
    { id: 'a3', status: 'pending', approver: { id: 'u3' } },
    { id: 'a4', status: 'cancelled', approver: { id: 'u4' } },
  ];

  it('finds the pending step where the viewer is the approver', () => {
    expect(findPendingApprovalForUser(approvals, 'u2')).toEqual({ id: 'a2' });
  });

  it('returns null when the viewer has no pending step of their own', () => {
    expect(findPendingApprovalForUser(approvals, 'u1')).toBeNull();
  });

  it('returns null when userId is null (session still loading)', () => {
    expect(findPendingApprovalForUser(approvals, null)).toBeNull();
  });

  it('ignores cancelled/approved steps even if they belong to the viewer', () => {
    expect(findPendingApprovalForUser(approvals, 'u4')).toBeNull();
  });
});
