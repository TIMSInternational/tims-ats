/**
 * Idempotent seed/teardown of the two parity-harness test orgs + one user per
 * configured role. `planSeed` is the pure, unit-tested part; `seed`/`teardown`
 * make real Supabase admin writes and are exercised only via the CLI (Task 11),
 * never by the test suite.
 *
 * ── Schema investigation (packages/db/prisma/schema/*.prisma) ──────────────
 *
 * organizations (organization.prisma, @@map("organizations")):
 *   id String @id @default(uuid()) @db.Uuid   -- DB-generated, never supplied.
 *   Non-null columns WITHOUT a default (must supply on insert): `name`, `slug`.
 *   `slug` is @unique. Everything else (`domain`, `logo`, `plan`, `settings`,
 *   `billing_email`, `is_active`, timestamps, `deleted_at`) is nullable or has
 *   a default. There is no separate "org membership" table — see users below.
 *
 * users (user.prisma, @@map("users")):
 *   id String @id @default(uuid()) @db.Uuid.
 *   Non-null columns WITHOUT a default: `supabase_user_id` (UNIQUE — this is
 *   the auth.users.id <-> public.users link column), `email`, `first_name`,
 *   `last_name`. `organization_id` is nullable (`String?`) but setting it IS
 *   the org-membership representation (single-org-per-user model; no join
 *   table). `@@unique([organization_id, email])` also holds.
 *
 * roles (rbac.prisma, @@map("roles")):
 *   id String @id @default(uuid()) @db.Uuid.
 *   Non-null columns WITHOUT a default: `organization_id` (FK, required —
 *   roles are PER-ORG), `name`, `slug`. `@@unique([organization_id, slug])`.
 *   A freshly created test org has ZERO roles, so seed() must create a Role
 *   row per (org, role-slug) before it can grant it — the harness's `roles`
 *   list (e.g. 'org_admin', 'manager') is used directly as both `name` and
 *   `slug`.
 *
 * user_roles (rbac.prisma, @@map("user_roles")):
 *   id String @id @default(uuid()) @db.Uuid.
 *   Non-null columns WITHOUT a default: `user_id` (FK -> users.id), `role_id`
 *   (FK -> roles.id). `@@unique([user_id, role_id])`. THIS row is the "role
 *   grant" — there is no separate permissions-assignment table for this.
 *
 * auth.users <-> public.users link: `users.supabase_user_id === auth.users.id`
 * (the id returned by `admin.auth.admin.createUser()`).
 * ────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthError, AuthUser, SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import type { HarnessConfig } from './config';
import { makeAdminClient } from './supabase';

/** Supabase's own root CA for direct-DB-connection hosts (db.<ref>.supabase.co) — not in Node's
 *  default trust store, so it must be pinned explicitly. Public certificate, safe to commit;
 *  downloaded from the live TLS handshake against this project's direct-connection endpoint
 *  (Supabase dashboard: Project Settings > Database > SSL Configuration > Download certificate
 *  serves the same chain). Pinning this CA (rejectUnauthorized: true, default) verifies the real
 *  chain — NOT a TLS bypass; `rejectUnauthorized: false` is never used here. */
const SUPABASE_ROOT_CA = readFileSync(join(__dirname, 'supabase-root-ca.pem'), 'utf8');

export interface SeededUser {
  email: string;
  password: string;
  orgKey: 'a' | 'b';
  role: string;
}

export interface SeedPlan {
  orgs: string[];
  users: SeededUser[];
}

export interface SeedResult {
  orgs: Record<'a' | 'b', string>;
  users: SeededUser[];
}

/** Known, test-only password for every seeded parity user. Not a real secret. */
const PASSWORD = 'Parity!Test-2026';

const ORG_SLUGS: Record<'a' | 'b', string> = { a: '__parity_a', b: '__parity_b' };
const ORG_KEYS: readonly ('a' | 'b')[] = ['a', 'b'];

/** Pure + deterministic: no I/O, no randomness. Unit-tested directly. */
export function planSeed(roles: string[]): SeedPlan {
  const users: SeededUser[] = [];
  for (const orgKey of ORG_KEYS)
    for (const role of roles)
      users.push({ email: `parity+${orgKey}-${role}@tims.test`, password: PASSWORD, orgKey, role });
  return { orgs: ORG_KEYS.map((k) => ORG_SLUGS[k]), users };
}

/**
 * Matches the deterministic seeded-email shape from `planSeed`: `parity+<a|b>-<role>@tims.test`.
 * `teardown()` uses this to sweep `auth.users` for leftovers WITHOUT depending on any
 * `public.users` row surviving (partial-teardown reversibility — see `teardown()`).
 */
export function isParityTestEmail(email: string): boolean {
  return /^parity\+(a|b)-.+@tims\.test$/i.test(email);
}

interface IdRow {
  id: string;
}

function isEmailAlreadyRegistered(error: AuthError): boolean {
  return error.code === 'email_exists' || /already.*(registered|exists)/i.test(error.message);
}

/**
 * DB-row writes (organizations/roles/users/user_roles) go through direct Postgres,
 * NOT `admin.from(...)` (PostgREST): this prod project has the Data API locked down —
 * `service_role` gets `permission denied for schema public` (42501) — and we must not
 * grant it public access (that would undo deliberate hardening). The `postgres` role
 * behind `cfg.databaseUrl` has BYPASSRLS, so parameterized inserts into RLS tables work
 * with no GUC. Auth-user writes still go through `admin.auth.admin.*` (GoTrue), which
 * is unaffected by the Data API lockdown — see `upsertAuthUser`/`listAllAuthUsers` below.
 */
function makeDbClient(cfg: HarnessConfig): Client {
  if (!cfg.databaseUrl) {
    throw new Error(
      'seed: DATABASE_URL is required to write DB rows via direct Postgres (the Data API is locked ' +
        'down for service_role on this project — see the seed()/teardown() comment in seed.ts). ' +
        'Set DATABASE_URL in scripts/parity/.env (Supabase dashboard > Project Settings > Database > ' +
        'Connection string > URI, "postgres" role).'
    );
  }
  // Pin Supabase's own root CA (SUPABASE_ROOT_CA above) rather than disabling verification —
  // db.<ref>.supabase.co's chain isn't in Node's default trust store, but IS a real chain rooted
  // at Supabase's own CA, so full verification (rejectUnauthorized: true, the default) still holds.
  return new Client({ connectionString: cfg.databaseUrl, ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } });
}

/** Insert-or-find an organization by slug. Returns its DB id.
 *  `id` and `updated_at` have no DB-level default (Prisma's `@default(uuid())`/`@updatedAt`
 *  generate client-side, not via a Postgres column default — confirmed via
 *  information_schema.columns), so raw SQL supplies both explicitly: `gen_random_uuid()`
 *  (built into Postgres core since v13, no pgcrypto extension needed) and `now()`. */
async function upsertOrg(db: Client, slug: string): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `INSERT INTO organizations (id, name, slug, updated_at) VALUES (gen_random_uuid(), $1, $2, now())
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [`TIMS Parity Harness (${slug})`, slug]
  );
  return rows[0].id;
}

/** Insert-or-find a per-org Role by (organization_id, slug). Returns its DB id. */
async function upsertRole(db: Client, organizationId: string, roleSlug: string): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `INSERT INTO roles (id, organization_id, name, slug, is_system, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $2, true, now())
     ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [organizationId, roleSlug]
  );
  return rows[0].id;
}

const AUTH_LIST_PAGE_SIZE = 200;
const AUTH_LIST_MAX_PAGES = 25;

/** GoTrue admin has no filter/get-by-email — page through every auth user (bounded). Shared by
 *  findAuthUserByEmail (seed) + findParityAuthUsers (teardown sweep). */
async function listAllAuthUsers(admin: SupabaseClient): Promise<AuthUser[]> {
  const all: AuthUser[] = [];
  for (let page = 1; page <= AUTH_LIST_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_LIST_PAGE_SIZE });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < AUTH_LIST_PAGE_SIZE) break;
  }
  return all;
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<string> {
  const hit = (await listAllAuthUsers(admin)).find((u) => u.email === email);
  if (!hit) throw new Error(`seed: "${email}" reported already-registered but was not found via listUsers`);
  return hit.id;
}

/** Sweep ALL auth users for the seeded parity email pattern — used by `teardown()`. */
async function findParityAuthUsers(admin: SupabaseClient): Promise<{ id: string; email: string }[]> {
  const users = await listAllAuthUsers(admin);
  return users
    .filter((u): u is AuthUser & { email: string } => !!u.email && isParityTestEmail(u.email))
    .map((u) => ({ id: u.id, email: u.email }));
}

/** Insert-or-find the auth.users row. Returns the auth user id. */
async function upsertAuthUser(admin: SupabaseClient, email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) {
    if (!data.user) throw new Error(`seed: createUser returned no user for ${email}`);
    return data.user.id;
  }
  if (!isEmailAlreadyRegistered(error)) throw error;
  return findAuthUserByEmail(admin, email);
}

/** Insert-or-find the public.users row linked via supabase_user_id. Returns its DB id. */
async function upsertPublicUser(
  db: Client,
  authUserId: string,
  organizationId: string,
  email: string,
  role: string
): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `INSERT INTO users (id, supabase_user_id, organization_id, email, first_name, last_name, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
     ON CONFLICT (supabase_user_id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       email = EXCLUDED.email,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       updated_at = now()
     RETURNING id`,
    [authUserId, organizationId, email, 'Parity', role]
  );
  return rows[0].id;
}

/** Insert-or-ignore the user_roles grant row. */
async function upsertUserRoleGrant(db: Client, userId: string, roleId: string): Promise<void> {
  await db.query(
    `INSERT INTO user_roles (id, user_id, role_id) VALUES (gen_random_uuid(), $1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleId]
  );
}

/**
 * Extension point for deeper team-intel KPI fixtures (OKRs, engagement surveys,
 * compensation bands, etc.) that later surface-specific parity checks may need.
 * Intentionally a no-op for the identity/RBAC-foundation seed shipped here.
 */
// TODO(surface-data): populate team-intel KPI fixtures once a specific surface
// needs them. Keep idempotent (swallow 23505) and FK-safe like the helpers above.
export async function seedTeamIntelData(
  _admin: SupabaseClient,
  _orgIds: Record<'a' | 'b', string>
): Promise<void> {
  // no-op — see TODO above.
}

/** Idempotent: creates the 2 test orgs + a Role + a user per configured role, if missing. */
export async function seed(cfg: HarnessConfig, roles: string[]): Promise<SeedResult> {
  const admin = makeAdminClient(cfg);
  const db = makeDbClient(cfg);
  const plan = planSeed(roles);

  await db.connect();
  try {
    const orgIds = { a: '', b: '' } as Record<'a' | 'b', string>;
    for (const key of ORG_KEYS) orgIds[key] = await upsertOrg(db, ORG_SLUGS[key]);

    const roleIds = new Map<string, string>();
    for (const key of ORG_KEYS)
      for (const role of roles) roleIds.set(`${key}:${role}`, await upsertRole(db, orgIds[key], role));

    for (const u of plan.users) {
      const authUserId = await upsertAuthUser(admin, u.email, u.password);
      const userId = await upsertPublicUser(db, authUserId, orgIds[u.orgKey], u.email, u.role);
      const roleId = roleIds.get(`${u.orgKey}:${u.role}`);
      if (!roleId) throw new Error(`seed: no planned role id for ${u.orgKey}:${u.role}`);
      await upsertUserRoleGrant(db, userId, roleId);
    }

    return { orgs: orgIds, users: plan.users };
  } finally {
    await db.end();
  }
}

/**
 * Idempotent + FK-safe: removes seeded grants, roles, public users, auth users, then orgs.
 *
 * Auth-user discovery is INDEPENDENT of `public.users` row survival: sweeps
 * `admin.auth.admin.listUsers()` (paginated) filtered by `isParityTestEmail`, rather than joining
 * through `public.users`. Otherwise, if a prior run threw mid-auth-loop, the `users` rows (deleted
 * in step 3, before the auth loop) would already be gone, and a join-based lookup could never find
 * those leftover `auth.users` accounts again. The sweep makes every re-run reversible regardless
 * of Postgres state.
 */
export async function teardown(cfg: HarnessConfig): Promise<void> {
  const admin = makeAdminClient(cfg);
  const db = makeDbClient(cfg);
  const slugs = ORG_KEYS.map((k) => ORG_SLUGS[k]);

  await db.connect();
  try {
    const orgsRes = await db.query<IdRow>('SELECT id FROM organizations WHERE slug = ANY($1)', [slugs]);
    const orgIds = orgsRes.rows.map((r) => r.id);

    const parityAuthUsers = await findParityAuthUsers(admin);
    if (orgIds.length === 0 && parityAuthUsers.length === 0) return; // nothing seeded — idempotent no-op

    let userIds: string[] = [];
    let roleIds: string[] = [];
    if (orgIds.length) {
      const usersRes = await db.query<IdRow>('SELECT id FROM users WHERE organization_id = ANY($1)', [orgIds]);
      userIds = usersRes.rows.map((u) => u.id);

      const rolesRes = await db.query<IdRow>('SELECT id FROM roles WHERE organization_id = ANY($1)', [orgIds]);
      roleIds = rolesRes.rows.map((r) => r.id);
    }

    // 1. user_roles — child of both users and roles.
    if (userIds.length) await db.query('DELETE FROM user_roles WHERE user_id = ANY($1)', [userIds]);
    if (roleIds.length) await db.query('DELETE FROM user_roles WHERE role_id = ANY($1)', [roleIds]);

    // 2. roles — child of organizations.
    if (roleIds.length) await db.query('DELETE FROM roles WHERE id = ANY($1)', [roleIds]);

    // 3. public users — child of organizations.
    if (userIds.length) await db.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);

    // 4. auth users — discovered above via email-pattern sweep, not the `users` join, so leftovers
    // from a prior partial failure are always found. allSettled: one failure must not abort the rest.
    const deletions = await Promise.allSettled(
      parityAuthUsers.map(async ({ id, email }) => {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error && error.code !== 'user_not_found') throw new Error(`${email}: ${error.message}`);
      })
    );

    // 5. organizations — parent, deleted last. Independent of auth.users; runs even if some auth
    // deletions above failed, so DB rows aren't left orphaned too.
    if (orgIds.length) await db.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);

    // After every deletion (DB rows + auth sweep) is attempted, surface any auth failure so the
    // caller learns of it — no orphan is left un-swept (a re-run still finds it via the sweep).
    const failures = deletions.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length) {
      const summary = failures
        .map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason)))
        .join('; ');
      throw new Error(`teardown: failed to delete ${failures.length} auth user(s): ${summary}`);
    }
  } finally {
    await db.end();
  }
}
