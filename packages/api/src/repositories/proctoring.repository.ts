import { tenantDb } from '@tims/db';

// The assessment-assignment creator remains in the TS domain until its .NET 10
// cutover. It reads the C#-managed assessment-type policy and verifies the org
// entitlement before snapshotting proctoringRequired. No proctoring writes are
// performed by this repository.
export const proctoringRepo = {
  hasEntitlement(organizationId: string) {
    return tenantDb.orgEntitlement.findFirst({
      where: { organizationId, moduleCode: 'proctoring', enabled: true },
      select: { id: true },
    });
  },
};
