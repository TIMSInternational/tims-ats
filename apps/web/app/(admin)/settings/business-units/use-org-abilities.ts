'use client';

import { usePermissions } from '../../../../lib/permissions';

/**
 * What the caller may do on the org-structure screen. Mirrors the C# route gates
 * (TenantOrgStructureEndpoints), which mirror today's tRPC gates: structure is super_admin-only
 * (organization:create/update), people assignment follows the user:* grants hr_admin holds.
 */
export interface OrgStructureAbilities {
  /** organization:create — new business units and teams. */
  createStructure: boolean;
  /** organization:update — rename / (de)activate units and teams. */
  updateStructure: boolean;
  /** user:create — add unit assignees and team members (tRPC assignUserToUnit). */
  assignPeople: boolean;
  /** user:delete — remove unit assignees and team members (tRPC unassignUserFromUnit). */
  unassignPeople: boolean;
  /** organization:update OR user:update — set or clear a team's leader. */
  setLeader: boolean;
  /** user:update — a user's home business unit. */
  setHomeUnit: boolean;
}

export function useOrgStructureAbilities(): OrgStructureAbilities {
  const { can } = usePermissions();
  const updateStructure = can('organization', 'update');
  return {
    createStructure: can('organization', 'create'),
    updateStructure,
    assignPeople: can('user', 'create'),
    unassignPeople: can('user', 'delete'),
    setLeader: updateStructure || can('user', 'update'),
    setHomeUnit: can('user', 'update'),
  };
}
