/**
 * RLS isolation check — run during/after the RLS cutover to prove tenant isolation
 * is actually enforced on the app_tenant connection.
 *
 * Prereqs: the RLS migration has been applied (policies exist) and you can connect
 * as the non-bypass app_tenant role.
 *
 * Usage:
 *   TENANT_DATABASE_URL='postgresql://app_tenant:<pw>@<host>:6543/postgres' \
 *   ORG_A=<uuid-with-data> ORG_B=<uuid-other> \
 *   npx tsx scripts/rls-isolation-check.ts
 *
 * Exits non-zero if any isolation assertion fails.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.TENANT_DATABASE_URL;
const A = process.env.ORG_A;
const B = process.env.ORG_B;
if (!url || !A || !B) {
  console.error('Set TENANT_DATABASE_URL, ORG_A, ORG_B');
  process.exit(2);
}

const app = new PrismaClient({ datasources: { db: { url } } });

function scoped<T>(orgId: string | null, q: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    if (orgId) await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
    return q(tx as unknown as PrismaClient);
  });
}
const candCount = (tx: PrismaClient) =>
  tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM candidates`.then((r) => r[0].n);

async function main() {
  const results: { name: string; pass: boolean; detail: string }[] = [];
  const seeA = await scoped(A, candCount);
  const seeB = await scoped(B, candCount);
  const seeNone = await scoped(null, candCount);

  results.push({ name: 'org A sees its own rows', pass: seeA > 0, detail: `${seeA}` });
  results.push({ name: 'org B cannot see org A rows', pass: seeB < seeA, detail: `B=${seeB} A=${seeA}` });
  results.push({ name: 'no context => fail closed (0, no error)', pass: seeNone === 0, detail: `${seeNone}` });

  let writeBlocked = false;
  try {
    await scoped(B, (tx) =>
      tx.$executeRaw`INSERT INTO candidates (id,organization_id,first_name,last_name,email,source,pool_type,created_at,updated_at)
        VALUES (gen_random_uuid(), ${A}::uuid,'rls','probe','rls-isolation-probe@example.com','portal','applicant',now(),now())`,
    );
  } catch {
    writeBlocked = true;
  }
  results.push({ name: 'WITH CHECK blocks cross-org write', pass: writeBlocked, detail: String(writeBlocked) });

  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
    if (!r.pass) failed++;
  }
  await app.$disconnect();
  if (failed) {
    console.error(`\n${failed} isolation assertion(s) FAILED — RLS is not enforcing correctly.`);
    process.exit(1);
  }
  console.log('\nAll isolation assertions passed.');
}

main().catch(async (e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  try {
    await app.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
