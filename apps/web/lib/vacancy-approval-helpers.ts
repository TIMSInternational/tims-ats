export function canSubmitForApproval(status: string): boolean {
  return status === 'draft';
}

export function findPendingApprovalForUser(
  approvals: Array<{ id: string; status: string; approver: { id: string } }>,
  userId: string | null,
): { id: string } | null {
  if (!userId) return null;
  const found = approvals.find((a) => a.status === 'pending' && a.approver.id === userId);
  return found ? { id: found.id } : null;
}
