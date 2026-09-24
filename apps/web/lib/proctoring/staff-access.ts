'use client';

import { usePermissions } from '../permissions';

/** UI affordances only; the .NET staff gate enforces the same sensitive role policy. */
export function useProctoringStaffAccess() {
  const { can, roles, isPrivileged, isLoading } = usePermissions();
  const canRead = (isPrivileged || roles.includes('hr_admin') || roles.includes('hrbp'))
    && can('assessment', 'read');
  const canWrite = isPrivileged && can('assessment', 'update');
  return { canRead, canWrite, isLoading };
}
