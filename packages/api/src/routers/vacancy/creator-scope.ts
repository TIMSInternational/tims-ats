import type { AccessContext } from '../../access';

// Narrow-scope vacancy creators (B-10: a team-scoped leader requesting a vacancy). Pure helpers used by
// vacancy.create and vacancy.duplicate; no data access.

/** organization/company grants see every vacancy; team/unit/own grants see only their anchored ones. */
export function isNarrowScope(access: AccessContext): boolean {
  return access.scope !== 'organization' && access.scope !== 'company';
}

/**
 * The assignee to store for a vacancy a TEAM-scoped caller creates. Their vacancy scope is
 * `teamId IN ledTeamIds OR assignedTo = me` (entity-policies.ts), so a request without a hiring manager and
 * outside the teams they lead vanished from their own list the moment it was created. Such a caller becomes
 * the request's hiring manager ("Responsable de la contratación"), which keeps it, its candidates and its
 * offers in their scope. An explicit assignee is never overridden. Other scopes are unchanged (own already
 * covers createdBy; org/company see everything).
 */
export async function assigneeForCreator(
  access: AccessContext,
  userId: string,
  teamId: string | null | undefined,
  assignedTo: string | null | undefined,
): Promise<string | undefined> {
  if (assignedTo) return assignedTo;
  if (access.scope !== 'team') return undefined;
  const ledTeamIds = access.anchors ? await access.anchors.ledTeamIds() : [];
  return teamId && ledTeamIds.includes(teamId) ? undefined : userId;
}
