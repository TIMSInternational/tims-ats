import { TRPCError } from '@trpc/server';
import type { AccessContext } from './types';

// Wave 2.5 slice 4 — write-rule for creates that TARGET another user (createOkr
// for userId X, coaching session for employee X). Such creates have NO row to
// probe, so the rule is: the TARGET must be inside the caller's subject set.
//   organization/company → no-op (deploy-neutral; pre-seed grants are org-wide)
//   own                  → only self (no anchor query)
//   team                 → led-team members (incl. self) via teamMemberIds()
//   unit                 → assigned-unit members via unitMemberIds()
// Fail-closed FORBIDDEN otherwise (incl. narrow scope with no anchor loader).
// `userId` is the CALLER's id; `targetUserId` is the user the create is about.
export async function assertSubjectInScope(
  access: AccessContext,
  userId: string,
  targetUserId: string,
  message: string,
): Promise<void> {
  const { scope, anchors } = access;
  if (scope === 'organization' || scope === 'company') return;
  if (scope === 'own') {
    if (targetUserId !== userId) throw new TRPCError({ code: 'FORBIDDEN', message });
    return;
  }
  if (!anchors) throw new TRPCError({ code: 'FORBIDDEN', message });
  const subjects = scope === 'team' ? await anchors.teamMemberIds() : await anchors.unitMemberIds();
  if (!subjects.includes(targetUserId)) throw new TRPCError({ code: 'FORBIDDEN', message });
}
