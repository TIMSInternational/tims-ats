'use client';

import { isOrgStructureViaCSharp } from '../../../../lib/platform-api/org-structure';
import { LegacyBusinessUnitsView } from './legacy-business-units-view';
import { OrgStructureManager } from './org-structure-manager';

/**
 * Business units, teams, leaders and members. Management (C#) is live only when
 * NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP is on; otherwise today's tRPC viewer is kept as-is.
 */
export default function BusinessUnitsPage() {
  return isOrgStructureViaCSharp() ? <OrgStructureManager /> : <LegacyBusinessUnitsView />;
}
