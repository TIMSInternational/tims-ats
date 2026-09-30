// Rebuild the embedded .NET role contract after changing seed-access-matrix.ts.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MATRIX, SYSTEM_ROLE_CATALOG, flattenEntries } from '../packages/db/prisma/seed-access-matrix';

const roles = SYSTEM_ROLE_CATALOG.map((role) => ({
  ...role,
  grants: flattenEntries(MATRIX[role.slug] ?? []),
}));
const destination = resolve(
  process.cwd(),
  'services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/role-grants.json',
);
writeFileSync(destination, `${JSON.stringify({ roles }, null, 2)}\n`);
