import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { STATE_DIR, assertLocalUrl, type Credentials, type Stack } from './stack';
import { newPassword } from './journey';

/** The platform owner seeded by packages/db/prisma/seed.ts (scripts/e2e/lib.sh E2E_OWNER_SUPABASE_ID). */
const SEEDED_OWNER_SUPABASE_ID = 'cd10598f-e1ee-4a1c-9b64-541d7a4a2488';

function ownerFile(runId: string): string {
  return join(STATE_DIR, `owner-${runId}.json`);
}

function serviceRoleKey(): string {
  const env = readFileSync(join(STATE_DIR, 'supabase.env'), 'utf8');
  const key = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(env)?.[1];
  if (!key) throw new Error('[e2e] SERVICE_ROLE_KEY missing from e2e/.state/supabase.env — re-run scripts/e2e/up.sh');
  return key;
}

/**
 * PRECONDITION helper (not something any spec asserts): a platform owner of this run's own.
 *
 * Platform owners are provisioned out of band in production — there is no UI for it — so the
 * journey starts from one. Each run (and each retry attempt) gets a fresh one (a copy of the seeded owner's `users` row and
 * roles, with a new local auth user) because the tRPC rate limiter is per user: a single owner
 * shared by back-to-back runs, or by a retry, exhausts its 100-queries/minute budget and the next
 * run's first page shows "Error inesperado".
 */
export async function provisionRunOwner(stack: Stack, runId: string): Promise<void> {
  if (existsSync(ownerFile(runId))) return;
  assertLocalUrl('supabase', stack.supabaseURL);
  assertLocalUrl('database', stack.databaseURL);
  const key = serviceRoleKey();
  const email = `owner.${runId}@e2e-platform.test`;
  const password = newPassword();

  const res = await fetch(`${stack.supabaseURL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`[e2e] creating the run's platform-owner auth user failed (HTTP ${res.status})`);
  const { id } = (await res.json()) as { id: string };

  const db = new pg.Client({ connectionString: stack.databaseURL });
  await db.connect();
  try {
    await db.query('BEGIN');
    // Copy the seeded owner's rows column-for-column, so this keeps working as the schema evolves.
    await db.query(
      'CREATE TEMP TABLE e2e_owner ON COMMIT DROP AS SELECT * FROM public.users WHERE supabase_user_id = $1',
      [SEEDED_OWNER_SUPABASE_ID],
    );
    const copied = await db.query(
      'UPDATE e2e_owner SET id = gen_random_uuid(), email = $1, supabase_user_id = $2 RETURNING id',
      [email, id],
    );
    if (copied.rowCount !== 1) throw new Error('[e2e] seeded platform owner not found — were the seeds applied?');
    const newUserId = copied.rows[0].id as string;
    await db.query('INSERT INTO public.users SELECT * FROM e2e_owner');
    await db.query(
      `CREATE TEMP TABLE e2e_owner_roles ON COMMIT DROP AS
         SELECT ur.* FROM public.user_roles ur JOIN public.users u ON u.id = ur.user_id WHERE u.supabase_user_id = $1`,
      [SEEDED_OWNER_SUPABASE_ID],
    );
    await db.query('UPDATE e2e_owner_roles SET id = gen_random_uuid(), user_id = $1', [newUserId]);
    await db.query('INSERT INTO public.user_roles SELECT * FROM e2e_owner_roles');
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
  writeFileSync(ownerFile(runId), JSON.stringify({ email, password }), { mode: 0o600 });
}

/** This run's platform-owner credentials (see provisionRunOwner). */
export function runOwnerCredentials(runId: string): Credentials {
  return JSON.parse(readFileSync(ownerFile(runId), 'utf8')) as Credentials;
}
