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

// ── RBAC grant fixtures ──────────────────────────────────────────────────────
// The C# PermissionService resolves a non-privileged role's access by joining
// role_permissions → roles (by org + slug) → permissions (by module+action)
// (Tims.Infrastructure/Identity/PermissionGrantRepository.FindGrantsAsync). A
// freshly-seeded org has NO role_permissions, so hr_admin (which product-intends
// team_intel:read at org scope, per packages/db/prisma/seed-access-matrix.ts)
// would 403 without this grant. super_admin needs no grant (privileged bypass);
// hrbp is intentionally ungranted (its 403 is the RBAC deny proof).

/** Upsert the global (module, action) permission-catalog row. Returns its id. */
async function upsertPermission(db: Client, module: string, action: string): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `INSERT INTO permissions (id, module, action, description)
     VALUES (gen_random_uuid(), $1, $2, $3)
     ON CONFLICT (module, action) DO UPDATE SET description = permissions.description
     RETURNING id`,
    [module, action, `${module}.${action}`]
  );
  return rows[0].id;
}

/** Grant a role a permission at `scope` (idempotent). `scope` uses the ladder in
 *  seed-access-matrix.ts ('own'|'team'|'unit'|'company'|'organization'). */
async function upsertRolePermission(
  db: Client,
  roleId: string,
  permissionId: string,
  scope: string
): Promise<void> {
  await db.query(
    `INSERT INTO role_permissions (id, role_id, permission_id, scope)
     VALUES (gen_random_uuid(), $1, $2, $3)
     ON CONFLICT (role_id, permission_id) DO UPDATE SET scope = EXCLUDED.scope`,
    [roleId, permissionId, scope]
  );
}

/** Grants hr_admin the team_intel:read permission at org scope in each seeded org,
 *  so the RBAC check's hr_admin=200 expectation holds (real prod seeds the full
 *  matrix during org provisioning; the harness seeds just this one surface grant). */
async function seedTeamIntelGrants(db: Client, roleIds: Map<string, string>): Promise<void> {
  const permId = await upsertPermission(db, 'team_intel', 'read');
  for (const key of ORG_KEYS) {
    const hrAdminRoleId = roleIds.get(`${key}:hr_admin`);
    if (hrAdminRoleId) await upsertRolePermission(db, hrAdminRoleId, permId, 'organization');
  }
}

// ── team-intel KPI fixtures (DIFFERENTIATED per org) ─────────────────────────
// getDashboardKpis (packages/api/src/routers/teamIntel.ts) counts teams /
// user_teams / team-leaders scoped to the caller's org. With BOTH orgs empty the
// two KPI payloads are identical all-zeros, which the RLS Mode B check can't
// distinguish from a leak (it fails closed on "identical non-empty"). Seeding
// DIFFERENT team data per org (A: 2 teams, 1 led, 1 member; B: 1 team, unled)
// makes the payloads differ → a real cross-tenant comparison runs and proves
// isolation (if org-B saw org-A's teams, its counts would match). teams require a
// business_unit → company chain, so those are seeded too. All find-or-create by
// (org, name): companies/business_units/teams have no natural unique key, so a
// plain re-insert would duplicate and inflate the counts on every re-run.

async function findOrCreateByName(
  db: Client,
  table: 'companies' | 'business_units' | 'teams',
  organizationId: string,
  name: string,
  insert: () => Promise<string>
): Promise<string> {
  const found = await db.query<IdRow>(
    `SELECT id FROM ${table} WHERE organization_id = $1 AND name = $2 LIMIT 1`,
    [organizationId, name]
  );
  if (found.rows.length) return found.rows[0].id;
  return insert();
}

async function findOrCreateCompany(db: Client, orgId: string, name: string): Promise<string> {
  return findOrCreateByName(db, 'companies', orgId, name, async () => {
    const { rows } = await db.query<IdRow>(
      `INSERT INTO companies (id, organization_id, name, country, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING id`,
      [orgId, name, 'CR']
    );
    return rows[0].id;
  });
}

async function findOrCreateBusinessUnit(db: Client, orgId: string, companyId: string, name: string): Promise<string> {
  return findOrCreateByName(db, 'business_units', orgId, name, async () => {
    const { rows } = await db.query<IdRow>(
      `INSERT INTO business_units (id, organization_id, company_id, name, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING id`,
      [orgId, companyId, name]
    );
    return rows[0].id;
  });
}

async function findOrCreateTeam(
  db: Client,
  orgId: string,
  businessUnitId: string,
  name: string,
  leaderId: string | null
): Promise<string> {
  return findOrCreateByName(db, 'teams', orgId, name, async () => {
    const { rows } = await db.query<IdRow>(
      `INSERT INTO teams (id, organization_id, business_unit_id, name, leader_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now()) RETURNING id`,
      [orgId, businessUnitId, name, leaderId]
    );
    return rows[0].id;
  });
}

/** Insert-or-ignore a team membership. */
async function upsertUserTeam(db: Client, userId: string, teamId: string): Promise<void> {
  await db.query(
    `INSERT INTO user_teams (id, user_id, team_id) VALUES (gen_random_uuid(), $1, $2)
     ON CONFLICT (user_id, team_id) DO NOTHING`,
    [userId, teamId]
  );
}

/** Seeds DIFFERENTIATED team-intel data so org-A's and org-B's dashboard KPIs
 *  diverge (see the block comment above). `userIds` maps `${orgKey}:${role}` →
 *  public.users.id (for the team leader + a member). Idempotent. */
export async function seedTeamIntelData(
  db: Client,
  orgIds: Record<'a' | 'b', string>,
  userIds: Map<string, string>
): Promise<void> {
  for (const key of ORG_KEYS) {
    const companyId = await findOrCreateCompany(db, orgIds[key], `Parity Co (${key})`);
    const buId = await findOrCreateBusinessUnit(db, orgIds[key], companyId, `Parity BU (${key})`);
    if (key === 'a') {
      // org A: 2 teams, team A1 led by a:super_admin with a:hr_admin as a member.
      const leaderId = userIds.get('a:super_admin') ?? null;
      const teamA1 = await findOrCreateTeam(db, orgIds.a, buId, 'Parity Team A1', leaderId);
      await findOrCreateTeam(db, orgIds.a, buId, 'Parity Team A2', null);
      const memberId = userIds.get('a:hr_admin');
      if (memberId) await upsertUserTeam(db, memberId, teamA1);
    } else {
      // org B: 1 team, no leader, no members → strictly fewer than org A on every team KPI.
      await findOrCreateTeam(db, orgIds.b, buId, 'Parity Team B1', null);
    }
  }
}

// billing-usage RLS/parity fixture. Inserts ONE subscriptions row in org A ONLY
// (org B intentionally has none). getCurrentPlan (packages/api/src/routers/billing.ts)
// findUnique-by-org returns that row for A and top-level `null` for B; getUsage's
// buildUsageView derives paid-plan limits + a populated period for A vs trial-fallback
// limits + null period for B. So both org-scoped billing reads yield DIFFERENT non-empty
// payloads across orgs. getCurrentPlan (row-for-A vs top-level `null`-for-B) is the airtight
// leak detector — any subscriptions-table cross-tenant leak makes B echo A's row (Mode B FAIL);
// getUsage corroborates but its limits differ unconditionally by plan. No grant is seeded: the
// billing surface probes/allows only super_admin (a permission-bypass role in both stacks),
// and hr_admin/hrbp correctly 403 with no billing grant. Native enums are cast explicitly
// (::"OrgPlan"/::"SubscriptionStatus"); id/updated_at supplied (Prisma @default(uuid())/
// @updatedAt are client-side — no DB default), created_at IS a real @default(now()) so it
// is omitted. Idempotent: ON CONFLICT (organization_id) refreshes the row in place.
async function seedBillingSubscription(db: Client, orgAId: string): Promise<void> {
  await db.query(
    `INSERT INTO subscriptions
       (id, organization_id, plan, status, current_period_start, current_period_end, updated_at)
     VALUES
       (gen_random_uuid(), $1, 'professional'::"OrgPlan", 'active'::"SubscriptionStatus",
        now(), now() + interval '30 days', now())
     ON CONFLICT (organization_id) DO UPDATE SET
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = now()`,
    [orgAId]
  );
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

    const userIds = new Map<string, string>();
    for (const u of plan.users) {
      const authUserId = await upsertAuthUser(admin, u.email, u.password);
      const userId = await upsertPublicUser(db, authUserId, orgIds[u.orgKey], u.email, u.role);
      userIds.set(`${u.orgKey}:${u.role}`, userId);
      const roleId = roleIds.get(`${u.orgKey}:${u.role}`);
      if (!roleId) throw new Error(`seed: no planned role id for ${u.orgKey}:${u.role}`);
      await upsertUserRoleGrant(db, userId, roleId);
    }

    // RBAC + RLS fixtures: hr_admin's team_intel:read grant (so hr_admin=200) and
    // DIFFERENTIATED per-org team data (so the RLS Mode B check has distinguishable
    // payloads to prove cross-tenant isolation). Both idempotent; only run when the
    // relevant roles were seeded.
    if (roles.includes('hr_admin')) await seedTeamIntelGrants(db, roleIds);
    await seedTeamIntelData(db, orgIds, userIds);

    // billing-usage RLS/parity fixture: a subscription in org A only (see
    // seedBillingSubscription). Org-independent, so it runs unconditionally.
    await seedBillingSubscription(db, orgIds.a);

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

    // 0. team-intel + grant fixtures — cleaned FIRST. teams.leader_id → users, so the
    //    team chain MUST go before the users delete (step 4) or that delete could hit a
    //    leader FK. role_permissions → roles (Cascade), swept here explicitly for clarity.
    if (orgIds.length) {
      const teamRows = await db.query<IdRow>('SELECT id FROM teams WHERE organization_id = ANY($1)', [orgIds]);
      const teamIds = teamRows.rows.map((r) => r.id);
      if (teamIds.length) await db.query('DELETE FROM user_teams WHERE team_id = ANY($1)', [teamIds]);
      await db.query('DELETE FROM teams WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM business_units WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM companies WHERE organization_id = ANY($1)', [orgIds]);
      // billing-usage fixture (org A only). Cascades on the org delete below too, but
      // swept explicitly here for clarity + so a teardown without a following reseed
      // leaves no orphan subscription row.
      await db.query('DELETE FROM subscriptions WHERE organization_id = ANY($1)', [orgIds]);
    }
    // role_permissions grant rows (permissions themselves are a global catalog — never deleted).
    if (roleIds.length) await db.query('DELETE FROM role_permissions WHERE role_id = ANY($1)', [roleIds]);

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
