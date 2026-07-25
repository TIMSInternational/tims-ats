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

// ── reporting (recruitmentAnalytics) fixtures ────────────────────────────────
// RBAC: `vacancy:read` is org-scoped. hr_admin gets it @organization (a real-grant
// 200 that clears requireOrgScope, like team-intel); hrbp gets it @unit so its 403
// exercises the REAL requireOrgScope path (has the grant, wrong scope) rather than a
// bare no-grant deny. super_admin needs no grant (permission-bypass role).
async function seedReportingGrants(db: Client, roleIds: Map<string, string>): Promise<void> {
  const permId = await upsertPermission(db, 'vacancy', 'read');
  for (const key of ORG_KEYS) {
    const hrAdminRoleId = roleIds.get(`${key}:hr_admin`);
    if (hrAdminRoleId) await upsertRolePermission(db, hrAdminRoleId, permId, 'organization');
    const hrbpRoleId = roleIds.get(`${key}:hrbp`);
    if (hrbpRoleId) await upsertRolePermission(db, hrbpRoleId, permId, 'unit');
  }
}

// Recruitment dataset for org A ONLY (org B stays empty) so all six recruitmentAnalytics
// reads return non-empty/differentiated payloads → a real RLS Mode B cross-tenant comparison
// (the fixed-shape reads kpis/funnel/trend/lost-by-delay differ A-non-zero vs B-all-zero; the
// array reads source-breakdown/recruiter-sla are A-non-empty vs B-empty). NONE of these tables
// use native Postgres enums (status/source/contract_type are plain text) → NO ::Enum casts.
// id + updated_at are supplied (client-side @default(uuid())/@updatedAt); created_at/applied_at
// have real now() DB defaults. pipeline_stages.order is the reserved word `order` → double-quoted.
// NO stage_movements are seeded: the null-movement path makes hoursInStage fall back to appliedAt.
// All timestamps are now()-K days with K far from the 30D window edge + trend month boundaries, and
// every span (TTF/TTH) is between two SEEDED timestamps, so C#/TS (each computing its own `now`)
// bucket identically and every rounded-day/count output matches. Idempotent + re-anchored on re-seed:
// candidates/applications upsert on their composite uniques; vacancy/stages/offer find-or-create then
// UPDATE their time-relative fields, so a re-run always re-centres the dates on the latest now().
async function upsertReportingCandidate(
  db: Client, orgId: string, email: string, first: string, last: string, source: string, poolType: string
): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `INSERT INTO candidates (id, organization_id, first_name, last_name, email, source, pool_type, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (organization_id, email) DO UPDATE SET
       source = EXCLUDED.source, pool_type = EXCLUDED.pool_type, updated_at = now()
     RETURNING id`,
    [orgId, first, last, email, source, poolType]
  );
  return rows[0].id;
}

async function upsertReportingVacancy(
  db: Client, orgId: string, title: string, createdBy: string, assignedTo: string
): Promise<string> {
  const found = await db.query<IdRow>(
    'SELECT id FROM vacancies WHERE organization_id = $1 AND title = $2 LIMIT 1',
    [orgId, title]
  );
  if (found.rows.length) {
    const id = found.rows[0].id;
    await db.query(
      `UPDATE vacancies SET assigned_to = $2, status = 'open', deleted_at = NULL,
         created_at = now() - make_interval(days => 20), updated_at = now() WHERE id = $1`,
      [id, assignedTo]
    );
    return id;
  }
  const { rows } = await db.query<IdRow>(
    `INSERT INTO vacancies (id, organization_id, title, created_by, assigned_to, status, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'open', now() - make_interval(days => 20), now())
     RETURNING id`,
    [orgId, title, createdBy, assignedTo]
  );
  return rows[0].id;
}

async function upsertReportingStage(
  db: Client, orgId: string, vacancyId: string, name: string, order: number, slaHours: number
): Promise<string> {
  const found = await db.query<IdRow>(
    'SELECT id FROM pipeline_stages WHERE vacancy_id = $1 AND name = $2 LIMIT 1',
    [vacancyId, name]
  );
  if (found.rows.length) {
    const id = found.rows[0].id;
    await db.query('UPDATE pipeline_stages SET "order" = $2, sla_hours = $3, updated_at = now() WHERE id = $1', [id, order, slaHours]);
    return id;
  }
  const { rows } = await db.query<IdRow>(
    `INSERT INTO pipeline_stages (id, organization_id, vacancy_id, name, "order", sla_hours, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
     RETURNING id`,
    [orgId, vacancyId, name, order, slaHours]
  );
  return rows[0].id;
}

async function upsertReportingApplication(
  db: Client, orgId: string, candidateId: string, vacancyId: string, stageId: string,
  source: string, status: string, appliedDaysAgo: number, rejectedDaysAgo: number | null
): Promise<string> {
  const rejectedExpr = rejectedDaysAgo == null ? 'NULL' : 'now() - make_interval(days => $8)';
  const params: unknown[] = [orgId, candidateId, vacancyId, stageId, source, status, appliedDaysAgo];
  if (rejectedDaysAgo != null) params.push(rejectedDaysAgo);
  const { rows } = await db.query<IdRow>(
    `INSERT INTO applications
       (id, organization_id, candidate_id, vacancy_id, current_stage_id, source, status, applied_at, rejected_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now() - make_interval(days => $7), ${rejectedExpr}, now())
     ON CONFLICT (candidate_id, vacancy_id) DO UPDATE SET
       current_stage_id = EXCLUDED.current_stage_id, source = EXCLUDED.source, status = EXCLUDED.status,
       applied_at = EXCLUDED.applied_at, rejected_at = EXCLUDED.rejected_at, updated_at = now()
     RETURNING id`,
    params
  );
  return rows[0].id;
}

async function upsertReportingOffer(
  db: Client, orgId: string, candidateId: string, vacancyId: string, applicationId: string, createdById: string
): Promise<void> {
  const found = await db.query<IdRow>(
    'SELECT id FROM offers WHERE organization_id = $1 AND application_id = $2 LIMIT 1',
    [orgId, applicationId]
  );
  if (found.rows.length) {
    await db.query(
      `UPDATE offers SET status = 'accepted', sent_at = now() - make_interval(days => 5),
         responded_at = now() - make_interval(days => 2), updated_at = now() WHERE id = $1`,
      [found.rows[0].id]
    );
    return;
  }
  await db.query(
    `INSERT INTO offers
       (id, organization_id, candidate_id, vacancy_id, application_id, status, salary, currency,
        start_date, contract_type, created_by_id, sent_at, responded_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'accepted', 50000, 'USD',
             now() + make_interval(days => 14), 'full_time', $5,
             now() - make_interval(days => 5), now() - make_interval(days => 2), now())`,
    [orgId, candidateId, vacancyId, applicationId, createdById]
  );
}

export async function seedReportingData(
  db: Client, orgAId: string, userIds: Map<string, string>
): Promise<void> {
  const recruiter = userIds.get('a:hr_admin');
  // Recruiter (vacancy.assignedTo → recruiter-sla) + creators need seeded users; skip if the
  // relevant roles weren't seeded (roles-subset callers). super_admin is the vacancy creator.
  if (!recruiter) return;
  const createdBy = userIds.get('a:super_admin') ?? recruiter;

  const cand1 = await upsertReportingCandidate(db, orgAId, 'parity+a-cand1@tims.test', 'Cand', 'One', 'linkedin', 'active');
  const cand2 = await upsertReportingCandidate(db, orgAId, 'parity+a-cand2@tims.test', 'Cand', 'Two', 'referral', 'active');
  // cand3 (also linkedin) makes the source counts DISTINCT — linkedin=2, referral=1 — so
  // source-breakdown's "sort by applications desc" is deterministic on both stacks regardless
  // of groupBy input order (no equal-count tie relying on the OrderBy(source) tiebreak).
  const cand3 = await upsertReportingCandidate(db, orgAId, 'parity+a-cand3@tims.test', 'Cand', 'Three', 'linkedin', 'active');
  const vac = await upsertReportingVacancy(db, orgAId, 'Parity Vacancy A1', createdBy, recruiter);
  const s1 = await upsertReportingStage(db, orgAId, vac, 'Applied', 0, 720); // 30d SLA: keeps the aged active apps on-time
  const s2 = await upsertReportingStage(db, orgAId, vac, 'Interview', 1, 48); // 48h SLA: the rejected app breaches it
  // active app (applied 15d ago, stage S1) → trend/kpi/funnel/source/hire-source + recruiter compliance-on-time.
  const appActive = await upsertReportingApplication(db, orgAId, cand1, vac, s1, 'linkedin', 'active', 15, null);
  // 2nd active linkedin app (applied 12d ago, stage S1) → distinct source count (linkedin=2 > referral=1).
  await upsertReportingApplication(db, orgAId, cand3, vac, s1, 'linkedin', 'active', 12, null);
  // rejected app (applied 10d ago, rejected 1d ago, stage S2 sla 48h → 9d-in-stage overdue) → lost-by-delay + kpi.lostByDelay.
  await upsertReportingApplication(db, orgAId, cand2, vac, s2, 'referral', 'rejected', 10, 1);
  // accepted offer on the first active app (sent 5d ago, responded 2d ago) → kpi hires/TTF/TTH/accept-rate + source hires.
  await upsertReportingOffer(db, orgAId, cand1, vac, appActive, recruiter);
}

// ── compensation fixtures ────────────────────────────────────────────────────
// RBAC: compensation:read hr_admin@org (real-grant 200) + hrbp@unit (403 on requireOrgScope
// reads, scoped-empty 200 on grant-only reads). super_admin bypasses.
// WRITE RBAC: hr_admin ALSO gets compensation:create + approve @org so the write allow-grant
// path (a NON-bypass role — super_admin bypasses permissions) is exercised = a real-grant 200.
// hrbp gets NEITHER create nor approve → it is the write deny role (403). (These extra grants
// are role_permissions rows, not data, so they don't affect any read RLS check.)
async function seedCompensationGrants(db: Client, roleIds: Map<string, string>): Promise<void> {
  const readPerm = await upsertPermission(db, 'compensation', 'read');
  const createPerm = await upsertPermission(db, 'compensation', 'create');
  const approvePerm = await upsertPermission(db, 'compensation', 'approve');
  for (const key of ORG_KEYS) {
    const hrAdmin = roleIds.get(`${key}:hr_admin`);
    if (hrAdmin) {
      await upsertRolePermission(db, hrAdmin, readPerm, 'organization');
      await upsertRolePermission(db, hrAdmin, createPerm, 'organization');
      await upsertRolePermission(db, hrAdmin, approvePerm, 'organization');
    }
    const hrbp = roleIds.get(`${key}:hrbp`);
    if (hrbp) await upsertRolePermission(db, hrbp, readPerm, 'unit');
  }
}

// Two bare org-A public.users rows (NO Supabase auth — they never log in; comp rows only need the
// users FK) with FIXED supabase_user_id so re-seed is idempotent. They pad the compa-ratio fixture to 5.
const COMP_USER_SUPA: Record<string, string> = {
  comp1: '00000000-0000-4000-8000-0000000c0001',
  comp2: '00000000-0000-4000-8000-0000000c0002',
};
async function upsertBareUser(
  db: Client, orgId: string, supaId: string, email: string, first: string, last: string
): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `INSERT INTO users (id, supabase_user_id, organization_id, email, first_name, last_name, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
     ON CONFLICT (supabase_user_id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id, email = EXCLUDED.email, updated_at = now()
     RETURNING id`,
    [supaId, orgId, email, first, last]
  );
  return rows[0].id;
}
async function upsertEmployeeComp(
  db: Client, orgId: string, userId: string, salary: number, compaRatio: number
): Promise<void> {
  await db.query(
    `INSERT INTO employee_compensations
       (id, organization_id, user_id, current_salary, compa_ratio, effective_date, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
     ON CONFLICT (organization_id, user_id) DO UPDATE SET
       current_salary = EXCLUDED.current_salary, compa_ratio = EXCLUDED.compa_ratio,
       effective_date = now(), updated_at = now()`,
    [orgId, userId, salary, compaRatio]
  );
}

// Seeds org A ONLY (org B empty → strong Mode B). 1 salary band (PARITY-L1, mid 100000 — also the
// succession comp-gap target band), 5 employee_compensations in ONE compa bucket (1.05) so compa-ratio-
// distribution clears min-5 (else it self-suppresses to an all-zero object == empty org B → false-fail),
// 1 benefit plan + enrollment, 1 pending salary adjustment. No native enums (type/status/currency plain
// text → no casts). a:super_admin gets a comp row so /my-compensation is 200-non-empty for the probe.
export async function seedCompensationData(
  db: Client, orgAId: string, userIds: Map<string, string>
): Promise<void> {
  const superId = userIds.get('a:super_admin');
  const hrId = userIds.get('a:hr_admin');
  const hrbpId = userIds.get('a:hrbp');
  if (!superId || !hrId || !hrbpId) return;

  await db.query(
    `INSERT INTO salary_bands (id, organization_id, level, title, min_salary, mid_salary, max_salary, updated_at)
     VALUES (gen_random_uuid(), $1, 'PARITY-L1', 'Parity Band L1', 80000, 100000, 120000, now())
     ON CONFLICT (organization_id, level) DO UPDATE SET
       min_salary = EXCLUDED.min_salary, mid_salary = EXCLUDED.mid_salary, max_salary = EXCLUDED.max_salary, updated_at = now()`,
    [orgAId]
  );
  const comp1 = await upsertBareUser(db, orgAId, COMP_USER_SUPA.comp1, 'parity+a-comp1@tims.test', 'Comp', 'One');
  const comp2 = await upsertBareUser(db, orgAId, COMP_USER_SUPA.comp2, 'parity+a-comp2@tims.test', 'Comp', 'Two');
  for (const uid of [superId, hrId, hrbpId, comp1, comp2]) await upsertEmployeeComp(db, orgAId, uid, 60000, 1.05);

  const found = await db.query<IdRow>('SELECT id FROM benefit_plans WHERE organization_id = $1 AND name = $2 LIMIT 1', [orgAId, 'Parity Health A']);
  const planId = found.rows.length
    ? found.rows[0].id
    : (await db.query<IdRow>(
        `INSERT INTO benefit_plans (id, organization_id, name, type, updated_at)
         VALUES (gen_random_uuid(), $1, 'Parity Health A', 'health', now()) RETURNING id`,
        [orgAId]
      )).rows[0].id;
  await db.query(
    `INSERT INTO benefit_enrollments (id, organization_id, user_id, benefit_plan_id)
     VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT (user_id, benefit_plan_id) DO NOTHING`,
    [orgAId, superId, planId]
  );

  const adj = await db.query<IdRow>(
    `SELECT id FROM salary_adjustments WHERE organization_id = $1 AND user_id = $2 AND status = 'pending' LIMIT 1`,
    [orgAId, hrId]
  );
  if (!adj.rows.length) {
    await db.query(
      `INSERT INTO salary_adjustments
         (id, organization_id, user_id, type, previous_salary, new_salary, requested_by_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'merit', 60000, 66000, $3, now())`,
      [orgAId, hrId, superId]
    );
  }
}

// ── evaluation360 fixtures ───────────────────────────────────────────────────
// RBAC: evaluation360:read hr_admin@org (real-grant 200). hrbp is deliberately NOT granted
// (matrix omits it — admin cycle reads are org-only), so hrbp 403s on the staff read + 200s
// on the self-service reads (no grant needed). Native enums → ::"Enum" casts.
async function seedEvaluation360Grants(db: Client, roleIds: Map<string, string>): Promise<void> {
  const readPerm = await upsertPermission(db, 'evaluation360', 'read');
  // create/update grants make hr_admin a genuine NON-bypass allow role for the write surface
  // (createCycle needs :create; the transitions need :update) — mirrors seedCompensationGrants,
  // so the write-verify allow-role live-test exercises real grant-resolution (M3/M5). hrbp stays
  // ungranted → the write-RBAC deny path (403) exercises a real no-grant denial. Read RBAC is
  // unaffected (no read is gated by create/update).
  const createPerm = await upsertPermission(db, 'evaluation360', 'create');
  const updatePerm = await upsertPermission(db, 'evaluation360', 'update');
  for (const key of ORG_KEYS) {
    const hrAdmin = roleIds.get(`${key}:hr_admin`);
    if (hrAdmin) {
      await upsertRolePermission(db, hrAdmin, readPerm, 'organization');
      await upsertRolePermission(db, hrAdmin, createPerm, 'organization');
      await upsertRolePermission(db, hrAdmin, updatePerm, 'organization');
    }
  }
}

// Fixed cycle UUIDs (idempotent ON CONFLICT id; also Tier-2-ready for the by-id cycle-progress/
// my-report probes which must bake a concrete cycle id into the path). The `*B` cycles live in ORG B
// and back the Tier-2 Mode-A IDOR positive control (org-B super_admin reads its own cycle → 200):
// openB = staff cycle-progress (a non-self rater_assignment → non-empty counts), pubB = self my-report
// (org-B super is a published self-subject with a response). See seedOrgBTier2Mirrors.
const EVAL_CYCLE: Record<string, string> = {
  openA: 'e0000360-0000-4000-8000-00000000000f',
  pubA: 'e0000360-0000-4000-8000-00000000000a',
  openB: 'e0000360-0000-4000-8000-00000000001f',
  pubB: 'e0000360-0000-4000-8000-00000000001a',
};
async function upsertReviewCycle(
  db: Client, id: string, orgId: string, name: string, status: string, createdBy: string, published: boolean
): Promise<void> {
  await db.query(
    `INSERT INTO review_cycles (id, organization_id, name, status, created_by_id, opens_at, published_at, updated_at)
     VALUES ($1, $2, $3, $4::"ReviewCycleStatus", $5, now() - make_interval(days => 30),
             ${published ? 'now() - make_interval(days => 5)' : 'NULL'}, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, published_at = EXCLUDED.published_at, updated_at = now()`,
    [id, orgId, name, status, createdBy]
  );
}
async function upsertRaterAssignment(
  db: Client, orgId: string, cycleId: string, subjectId: string, raterId: string, relationship: string, status: string
): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `INSERT INTO rater_assignments
       (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::"RaterRelationship", $6::"RaterAssignmentStatus", now())
     ON CONFLICT (cycle_id, subject_user_id, rater_user_id) DO UPDATE SET
       relationship = EXCLUDED.relationship, status = EXCLUDED.status, updated_at = now()
     RETURNING id`,
    [orgId, cycleId, subjectId, raterId, relationship, status]
  );
  return rows[0].id;
}

// Org A ONLY (org B empty → strong Mode B). An open cycle + a published cycle; super_admin (the probe)
// is a RATER of hr_admin in the open cycle (→ my-rater-tasks non-empty) AND a self-SUBJECT of the
// published cycle with a response (→ my-report-cycles non-empty + the Tier-2 my-report content).
export async function seedEvaluation360Data(
  db: Client, orgAId: string, userIds: Map<string, string>
): Promise<void> {
  const superId = userIds.get('a:super_admin');
  const hrId = userIds.get('a:hr_admin');
  if (!superId || !hrId) return;
  await upsertReviewCycle(db, EVAL_CYCLE.openA, orgAId, 'Parity Open Cycle A', 'open', superId, false);
  await upsertReviewCycle(db, EVAL_CYCLE.pubA, orgAId, 'Parity Published Cycle A', 'published', superId, true);
  await upsertRaterAssignment(db, orgAId, EVAL_CYCLE.openA, hrId, superId, 'peer', 'pending');
  const selfAssign = await upsertRaterAssignment(db, orgAId, EVAL_CYCLE.pubA, superId, superId, 'self', 'submitted');
  await db.query(
    `INSERT INTO rater_responses (id, organization_id, assignment_id, competency_key, rating, comment, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'communication', 4, 'self note', now())
     ON CONFLICT (assignment_id, competency_key) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`,
    [orgAId, selfAssign]
  );
}

// ── nine-box fixtures ────────────────────────────────────────────────────────
// RBAC: ninebox:read hr_admin@org + hrbp@unit. No native enums (quadrant/status plain text).
async function seedNineBoxGrants(db: Client, roleIds: Map<string, string>): Promise<void> {
  const permId = await upsertPermission(db, 'ninebox', 'read');
  for (const key of ORG_KEYS) {
    const hrAdmin = roleIds.get(`${key}:hr_admin`);
    if (hrAdmin) await upsertRolePermission(db, hrAdmin, permId, 'organization');
    const hrbp = roleIds.get(`${key}:hrbp`);
    if (hrbp) await upsertRolePermission(db, hrbp, permId, 'unit');
  }
}
async function upsertNineBoxEval(
  db: Client, orgId: string, userId: string, period: string, pot: number, perf: number, quadrant: string, evalDaysAgo: number
): Promise<void> {
  // axis_breakdown is jsonb NOT NULL; nine_box_evaluations has NO updated_at column. Distinct
  // evaluated_at (K days ago) keeps grid/movement ordering deterministic across stacks.
  await db.query(
    `INSERT INTO nine_box_evaluations
       (id, organization_id, user_id, period, potential_score, performance_score, quadrant, confidence, axis_breakdown, evaluated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 0.8, '{"leadership":70,"execution":65}'::jsonb, now() - make_interval(days => $7))
     ON CONFLICT (organization_id, user_id, period) DO UPDATE SET
       potential_score = EXCLUDED.potential_score, performance_score = EXCLUDED.performance_score,
       quadrant = EXCLUDED.quadrant, evaluated_at = EXCLUDED.evaluated_at`,
    [orgId, userId, period, pot, perf, quadrant, evalDaysAgo]
  );
}
async function findOrCreateCalibrationSession(
  db: Client, orgId: string, createdBy: string, period: string, status: string
): Promise<string> {
  const found = await db.query<IdRow>(
    'SELECT id FROM calibration_sessions WHERE organization_id = $1 AND created_by_id = $2 AND period = $3 LIMIT 1',
    [orgId, createdBy, period]
  );
  if (found.rows.length) return found.rows[0].id;
  const { rows } = await db.query<IdRow>(
    `INSERT INTO calibration_sessions (id, organization_id, period, status, created_by_id, updated_at)
     VALUES (gen_random_uuid(), $1, $3, $4, $2, now()) RETURNING id`,
    [orgId, createdBy, period, status]
  );
  return rows[0].id;
}

// Org A ONLY (org B empty → strong Mode B). 3 evaluated employees @ 2026-Q1 (star/core_player/
// high_potential) + super_admin's prior 2025-Q4 eval (drives movement-history), + 1 draft calibration
// session (super_admin = creator → my-calibrations) with 1 member + 1 vote (kept ≤1 each so the Tier-2
// by-id members/votes arrays have no ordering ambiguity).
export async function seedNineBoxData(
  db: Client, orgAId: string, userIds: Map<string, string>
): Promise<void> {
  const superId = userIds.get('a:super_admin');
  const hrId = userIds.get('a:hr_admin');
  const hrbpId = userIds.get('a:hrbp');
  if (!superId || !hrId || !hrbpId) return;
  await upsertNineBoxEval(db, orgAId, superId, '2026-Q1', 80, 80, 'star', 1);
  await upsertNineBoxEval(db, orgAId, hrId, '2026-Q1', 50, 50, 'core_player', 2);
  await upsertNineBoxEval(db, orgAId, hrbpId, '2026-Q1', 80, 50, 'high_potential', 3);
  await upsertNineBoxEval(db, orgAId, superId, '2025-Q4', 50, 50, 'core_player', 90);
  const session = await findOrCreateCalibrationSession(db, orgAId, superId, '2026-Q1', 'draft');
  await db.query(
    `INSERT INTO calibration_members (id, session_id, user_id, status) VALUES (gen_random_uuid(), $1, $2, 'invited')
     ON CONFLICT (session_id, user_id) DO NOTHING`,
    [session, hrId]
  );
  await db.query(
    `INSERT INTO calibration_votes (id, session_id, evaluated_user_id, voter_id, quadrant)
     VALUES (gen_random_uuid(), $1, $2, $3, 'core_player')
     ON CONFLICT (session_id, evaluated_user_id, voter_id) DO NOTHING`,
    [session, hrbpId, hrId]
  );
}

// ── succession fixtures ──────────────────────────────────────────────────────
// RBAC: succession:read hr_admin@org + hrbp@unit. hr_admin's compensation:read@org grant (for the
// comp-gap-alerts secondary check) is already seeded by seedCompensationGrants. No native enums.
async function seedSuccessionGrants(db: Client, roleIds: Map<string, string>): Promise<void> {
  const readPerm = await upsertPermission(db, 'succession', 'read');
  // create/update/delete grants make hr_admin a genuine org-scoped write role (mirrors the prod
  // access model + seedCompensationGrants). The succession write-verify does NOT allow-live-test
  // hr_admin (no caller-stamped column usable with the shared-body harness — see write-surfaces.ts),
  // so these are correctness/future-proofing; hrbp stays read-only@unit → its write attempts 403 at
  // the gate. Read RBAC is unaffected (no read is gated by create/update/delete).
  const createPerm = await upsertPermission(db, 'succession', 'create');
  const updatePerm = await upsertPermission(db, 'succession', 'update');
  const deletePerm = await upsertPermission(db, 'succession', 'delete');
  for (const key of ORG_KEYS) {
    const hrAdmin = roleIds.get(`${key}:hr_admin`);
    if (hrAdmin) {
      await upsertRolePermission(db, hrAdmin, readPerm, 'organization');
      await upsertRolePermission(db, hrAdmin, createPerm, 'organization');
      await upsertRolePermission(db, hrAdmin, updatePerm, 'organization');
      await upsertRolePermission(db, hrAdmin, deletePerm, 'organization');
    }
    const hrbp = roleIds.get(`${key}:hrbp`);
    if (hrbp) await upsertRolePermission(db, hrbp, readPerm, 'unit');
  }
}
async function findOrCreateCriticalRole(
  db: Client, orgId: string, title: string, criticality: string,
  flightRisk: number | null, targetBand: string | null, holderId: string | null
): Promise<string> {
  const found = await db.query<IdRow>('SELECT id FROM critical_roles WHERE organization_id = $1 AND title = $2 LIMIT 1', [orgId, title]);
  if (found.rows.length) {
    const id = found.rows[0].id;
    await db.query(
      `UPDATE critical_roles SET criticality = $2, flight_risk = $3, target_band_level = $4, current_holder_id = $5, updated_at = now() WHERE id = $1`,
      [id, criticality, flightRisk, targetBand, holderId]
    );
    return id;
  }
  const { rows } = await db.query<IdRow>(
    `INSERT INTO critical_roles
       (id, organization_id, title, criticality, flight_risk, target_band_level, current_holder_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now()) RETURNING id`,
    [orgId, title, criticality, flightRisk, targetBand, holderId]
  );
  return rows[0].id;
}

// Org A ONLY (org B empty → strong Mode B). CR1 (critical, flight_risk 0.9, target band PARITY-L1, holder
// super_admin) WITH a ready-now successor (hr_admin — whose 60000 comp row from the compensation seed is
// < PARITY-L1 mid 100000 * 0.9 = 90000 → comp-gap-alert fires) + CR2 (high, no successor →
// roles-without-successor). MUST run after seedCompensationData (reuses its band + comp rows).
export async function seedSuccessionData(
  db: Client, orgAId: string, userIds: Map<string, string>
): Promise<void> {
  const superId = userIds.get('a:super_admin');
  const hrId = userIds.get('a:hr_admin');
  if (!superId || !hrId) return;
  const cr1 = await findOrCreateCriticalRole(db, orgAId, 'Parity Critical Role A1', 'critical', 0.9, 'PARITY-L1', superId);
  await findOrCreateCriticalRole(db, orgAId, 'Parity Critical Role A2', 'high', null, null, null);
  await db.query(
    `INSERT INTO successors
       (id, organization_id, critical_role_id, user_id, readiness, type, added_by_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'ready_now', 'internal', $4, now())
     ON CONFLICT (critical_role_id, user_id) DO UPDATE SET readiness = EXCLUDED.readiness, type = EXCLUDED.type, updated_at = now()`,
    [orgAId, cr1, hrId, superId]
  );
}

// ── Tier-2 by-id ORG-B mirrors ───────────────────────────────────────────────
// The Tier-1 seed puts every fixture in org A ONLY (org B empty → strong Mode B).
// The Tier-2 by-id Mode-A IDOR probes additionally need the org-B resource to be
// LIVE (org-B super_admin must reach it → 200), so the harness's positive control
// can tell a real isolation pass from a trivial 404 on a dead id. This seeds the
// minimal org-B mirror for each by-id resource: an employee comp row + nine-box
// eval for b:hr_admin, an org-B calibration session (+member/vote), the openB/pubB
// review cycles (+assignments/response), and an org-B critical role. All idempotent
// and swept by teardown (which deletes every one of these tables by org id, both orgs).
export async function seedOrgBTier2Mirrors(
  db: Client, orgBId: string, userIds: Map<string, string>
): Promise<void> {
  const bSuper = userIds.get('b:super_admin');
  const bHr = userIds.get('b:hr_admin');
  const bHrbp = userIds.get('b:hrbp');
  if (!bSuper || !bHr) return;

  // compensation employee/{userId} + ninebox employee/{userId}(+axis-breakdown): b:hr_admin is the target.
  // The nine-box eval is high_potential (not core_player) so it also ranks as a suggested successor for
  // the succession suggested-successors positive control (that read only surfaces star/high-potential).
  await upsertEmployeeComp(db, orgBId, bHr, 60000, 1.05);
  await upsertNineBoxEval(db, orgBId, bHr, '2026-Q1', 80, 50, 'high_potential', 2);

  // ninebox calibrations/{id}: an org-B session (super = creator → readable by org-B super). Member/vote
  // mirror org A (member b:hr_admin; vote evaluated b:hrbp by b:hr_admin) when those roles exist.
  const sessionB = await findOrCreateCalibrationSession(db, orgBId, bSuper, '2026-Q1', 'draft');
  await db.query(
    `INSERT INTO calibration_members (id, session_id, user_id, status) VALUES (gen_random_uuid(), $1, $2, 'invited')
     ON CONFLICT (session_id, user_id) DO NOTHING`,
    [sessionB, bHr]
  );
  if (bHrbp) {
    await db.query(
      `INSERT INTO calibration_votes (id, session_id, evaluated_user_id, voter_id, quadrant)
       VALUES (gen_random_uuid(), $1, $2, $3, 'core_player')
       ON CONFLICT (session_id, evaluated_user_id, voter_id) DO NOTHING`,
      [sessionB, bHrbp, bHr]
    );
  }

  // evaluation360 cycles/{id}/progress (openB): a non-self assignment (subject b:hr_admin, rater b:super)
  // so the org-B super's staff progress read is non-empty. my/reports/{cycleId} (pubB): b:super is a
  // published self-subject with a response, so its own my-report returns data.
  await upsertReviewCycle(db, EVAL_CYCLE.openB, orgBId, 'Parity Open Cycle B', 'open', bSuper, false);
  await upsertRaterAssignment(db, orgBId, EVAL_CYCLE.openB, bHr, bSuper, 'peer', 'pending');
  await upsertReviewCycle(db, EVAL_CYCLE.pubB, orgBId, 'Parity Published Cycle B', 'published', bSuper, true);
  const selfAssignB = await upsertRaterAssignment(db, orgBId, EVAL_CYCLE.pubB, bSuper, bSuper, 'self', 'submitted');
  await db.query(
    `INSERT INTO rater_responses (id, organization_id, assignment_id, competency_key, rating, comment, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'communication', 4, 'self note', now())
     ON CONFLICT (assignment_id, competency_key) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`,
    [orgBId, selfAssignB]
  );

  // succession critical-roles/{id}(+suggested-successors, +simulate-exit): an org-B critical role held by
  // b:super. suggested-successors is non-empty via the b:hr_admin nine-box eval seeded above.
  await findOrCreateCriticalRole(db, orgBId, 'Parity Critical Role B1', 'critical', 0.5, 'PARITY-L1', bSuper);
}

// ── Write-verification preconditions ─────────────────────────────────────────
// The compensation write tracer's approve endpoint needs a PENDING salary_adjustments
// row it can flip: org A already has one (seedCompensationData → a:hr_admin), reused as
// the approve fixture. This adds the ORG-B counterpart (the approve-IDOR target: an
// org-A token approving it must be denied AND leave it pending). requested_by = b:super
// (org B's own actor), distinct from org A's super, so the create-IDOR no-mutation check
// (which keys on requested_by = the cross-org attacker) is not confused by it.
// Idempotent: skips if an org-B pending row for b:hr_admin already exists.
export async function seedCompensationWritePreconditions(
  db: Client, orgBId: string, userIds: Map<string, string>
): Promise<void> {
  const bSuper = userIds.get('b:super_admin');
  const bHr = userIds.get('b:hr_admin');
  if (!bSuper || !bHr) return;
  const found = await db.query<IdRow>(
    `SELECT id FROM salary_adjustments WHERE organization_id = $1 AND user_id = $2 AND status = 'pending' LIMIT 1`,
    [orgBId, bHr]
  );
  if (found.rows.length) return;
  await db.query(
    `INSERT INTO salary_adjustments
       (id, organization_id, user_id, type, previous_salary, new_salary, currency, status, requested_by_id, effective_date, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'merit', 60000, 66000, 'USD', 'pending', $3, now(), now())`,
    [orgBId, bHr, bSuper]
  );
}

// ── Write-verification resource resolution ───────────────────────────────────
export interface WriteResources {
  /** org-A user id per probe/deny role (super_admin/hr_admin/hrbp). */
  userIdByRole: Record<string, string>;
  /** org-A subject employee (a:hr_admin) — create target + approve-fixture owner. */
  subjectA: string;
  /** org-B subject employee (b:hr_admin) — cross-org target. */
  subjectB: string;
  /** org-A pending salary_adjustments id (approve target). */
  resourceA: string;
  /** org-B pending salary_adjustments id (approve IDOR target). */
  resourceB: string;
}

/** Seeds the compensation write-verify-only preconditions that must NOT live in the shared
 *  read seed (they would degrade a read RLS check — see the note in `seed()`): the org-B
 *  pending adjustment (the approve-IDOR target). Idempotent; the surface's `ensurePreconditions`
 *  hook (write-surfaces.ts), called from the write-verify flow after a normal `seed`. */
export async function ensureCompensationWritePreconditions(cfg: HarnessConfig): Promise<void> {
  const db = makeDbClient(cfg);
  await db.connect();
  try {
    const orgB = await orgIdBySlug(db, ORG_SLUGS.b);
    const userIds = new Map<string, string>([
      ['b:super_admin', await userIdByEmail(db, 'parity+b-super_admin@tims.test')],
      ['b:hr_admin', await userIdByEmail(db, 'parity+b-hr_admin@tims.test')],
    ]);
    await seedCompensationWritePreconditions(db, orgB, userIds);
  } finally {
    await db.end();
  }
}

/** Read-only resolution of the compensation write tracer's ids from the seeded DB.
 *  Requires a fresh teardown+seed + `ensureCompensationWritePreconditions` (an approve
 *  mutates resourceA out of 'pending'). */
export async function resolveCompensationWriteResources(cfg: HarnessConfig): Promise<WriteResources> {
  const db = makeDbClient(cfg);
  await db.connect();
  try {
    const orgA = await orgIdBySlug(db, ORG_SLUGS.a);
    const orgB = await orgIdBySlug(db, ORG_SLUGS.b);
    const superA = await userIdByEmail(db, 'parity+a-super_admin@tims.test');
    const hrA = await userIdByEmail(db, 'parity+a-hr_admin@tims.test');
    const hrbpA = await userIdByEmail(db, 'parity+a-hrbp@tims.test');
    const hrB = await userIdByEmail(db, 'parity+b-hr_admin@tims.test');
    const pendingAdjustmentId = async (orgId: string, userId: string): Promise<string> => {
      const { rows } = await db.query<IdRow>(
        `SELECT id FROM salary_adjustments WHERE organization_id = $1 AND user_id = $2 AND status = 'pending' LIMIT 1`,
        [orgId, userId]
      );
      if (!rows.length) throw new Error(`resolveWriteResources: no pending adjustment for user ${userId} in org ${orgId} — run \`cli.ts seed --teardown\` then \`seed\` (an approve consumes it)`);
      return rows[0].id;
    };
    return {
      userIdByRole: { super_admin: superA, hr_admin: hrA, hrbp: hrbpA },
      subjectA: hrA,
      subjectB: hrB,
      resourceA: await pendingAdjustmentId(orgA, hrA),
      resourceB: await pendingAdjustmentId(orgB, hrB),
    };
  } finally {
    await db.end();
  }
}

// ── evaluation360 write-verification preconditions ───────────────────────────
// The eval360 write surface (6 writes) needs FROM-state cycles the transitions can consume.
// Unlike the compensation tracer (which reused a read fixture), these are DISTINCT fixed-UUID
// cycles seeded ONLY in the write-verify path — one org-A + one org-B per state-transition
// endpoint (open needs draft, close needs open, publish needs closed, assign needs draft) plus
// an open cycle + a pending self-rater assignment per org for submitRatings. Kept out of the
// shared read seed so they can't affect the read RLS/parity checks (H1 lesson). All swept by
// teardown (which deletes review_cycles/rater_assignments/rater_responses by org, both orgs).

/** The write-verify-only cycle fixtures (fixed UUIDs, distinct from the read EVAL_CYCLE set).
 *  Defined here (not write-surfaces.ts) to keep the seed→registry import one-directional. */
export const WRITE_EVAL_CYCLES = {
  draftA: 'e0000361-0000-4000-8000-000000000001',
  draftB: 'e0000361-0000-4000-8000-000000000002',
  openA: 'e0000361-0000-4000-8000-000000000003',
  openB: 'e0000361-0000-4000-8000-000000000004',
  closedA: 'e0000361-0000-4000-8000-000000000005',
  closedB: 'e0000361-0000-4000-8000-000000000006',
  assignA: 'e0000361-0000-4000-8000-000000000007',
  assignB: 'e0000361-0000-4000-8000-000000000008',
  submitA: 'e0000361-0000-4000-8000-000000000009',
  submitB: 'e0000361-0000-4000-8000-00000000000a',
} as const;

/** The createCycle marker name — createCycle rows self-locate by (created_by, this name). */
export const WRITE_CYCLE_MARKER = 'Parity Write Cycle';

const WRITE_CYCLE_IDS = Object.values(WRITE_EVAL_CYCLES);

/** Minimal review_cycles upsert for the write preconditions: sets only status + org + name
 *  (opens_at/closes_at/published_at stay NULL — the transition guards check status only), and
 *  RESETS status on conflict so a re-run without teardown restores the from-state. */
async function upsertWriteReviewCycle(
  db: Client, id: string, orgId: string, name: string, status: string, createdBy: string
): Promise<void> {
  await db.query(
    `INSERT INTO review_cycles (id, organization_id, name, status, created_by_id, updated_at)
     VALUES ($1, $2, $3, $4::"ReviewCycleStatus", $5, now())
     ON CONFLICT (id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id, name = EXCLUDED.name,
       status = EXCLUDED.status, updated_at = now()`,
    [id, orgId, name, status, createdBy]
  );
}

/** Seeds the eval360 write-verify preconditions (fresh each run — deletes prior write-cycle
 *  assignments/responses + createCycle marker rows first, so re-runs are idempotent even
 *  without a teardown). */
export async function seedEvaluation360WritePreconditions(
  db: Client, orgAId: string, orgBId: string, userIds: Map<string, string>
): Promise<void> {
  const superA = userIds.get('a:super_admin');
  const hrA = userIds.get('a:hr_admin');
  const bSuper = userIds.get('b:super_admin');
  const bHr = userIds.get('b:hr_admin');
  if (!superA || !hrA || !bSuper || !bHr) return;

  // 1. Cleanup: drop any prior write-cycle assignments/responses (FK-safe: responses first) and
  //    the createCycle marker rows, so the light-parity mutations start from a known clean state.
  await db.query(
    `DELETE FROM rater_responses WHERE assignment_id IN (SELECT id FROM rater_assignments WHERE cycle_id = ANY($1))`,
    [WRITE_CYCLE_IDS]
  );
  await db.query('DELETE FROM rater_assignments WHERE cycle_id = ANY($1)', [WRITE_CYCLE_IDS]);
  await db.query(
    `DELETE FROM review_cycles WHERE organization_id = ANY($1) AND name = $2`,
    [[orgAId, orgBId], WRITE_CYCLE_MARKER]
  );

  // 2. State-transition from-state cycles (org A = parity/rbac-deny target; org B = IDOR target).
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.draftA, orgAId, 'Parity Write Draft A', 'draft', superA);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.draftB, orgBId, 'Parity Write Draft B', 'draft', bSuper);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.openA, orgAId, 'Parity Write Open A', 'open', superA);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.openB, orgBId, 'Parity Write Open B', 'open', bSuper);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.closedA, orgAId, 'Parity Write Closed A', 'closed', superA);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.closedB, orgBId, 'Parity Write Closed B', 'closed', bSuper);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.assignA, orgAId, 'Parity Write Assign A', 'draft', superA);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.assignB, orgBId, 'Parity Write Assign B', 'draft', bSuper);

  // 3. submitRatings: an OPEN cycle + a PENDING self-rater assignment per org (rater = the org's
  //    super_admin, the write-verify probe). Cross-org IDOR: org-A super submitting for submitB's
  //    assignment (rater = b:super) → ownership pre-fetch fails → 404.
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.submitA, orgAId, 'Parity Write Submit A', 'open', superA);
  await upsertWriteReviewCycle(db, WRITE_EVAL_CYCLES.submitB, orgBId, 'Parity Write Submit B', 'open', bSuper);
  await upsertRaterAssignment(db, orgAId, WRITE_EVAL_CYCLES.submitA, hrA, superA, 'peer', 'pending');
  await upsertRaterAssignment(db, orgBId, WRITE_EVAL_CYCLES.submitB, bHr, bSuper, 'peer', 'pending');
}

/** Resolved-id shape for the eval360 write surface (Omit<Evaluation360WriteResolved,'base'>). */
export interface Evaluation360WriteResources {
  userIdByRole: Record<string, string>;
  subjectA: string;
  submitAssignA: string;
  submitAssignB: string;
}

/** The surface's ensurePreconditions hook. */
export async function ensureEvaluation360WritePreconditions(cfg: HarnessConfig): Promise<void> {
  const db = makeDbClient(cfg);
  await db.connect();
  try {
    const orgA = await orgIdBySlug(db, ORG_SLUGS.a);
    const orgB = await orgIdBySlug(db, ORG_SLUGS.b);
    const userIds = new Map<string, string>([
      ['a:super_admin', await userIdByEmail(db, 'parity+a-super_admin@tims.test')],
      ['a:hr_admin', await userIdByEmail(db, 'parity+a-hr_admin@tims.test')],
      ['b:super_admin', await userIdByEmail(db, 'parity+b-super_admin@tims.test')],
      ['b:hr_admin', await userIdByEmail(db, 'parity+b-hr_admin@tims.test')],
    ]);
    await seedEvaluation360WritePreconditions(db, orgA, orgB, userIds);
  } finally {
    await db.end();
  }
}

/** The surface's resolveResources hook. The submit assignment ids (gen_random_uuid) resolve by
 *  natural key (cycle + rater); the fixed cycle ids are constants the registry references directly. */
export async function resolveEvaluation360WriteResources(cfg: HarnessConfig): Promise<Evaluation360WriteResources> {
  const db = makeDbClient(cfg);
  await db.connect();
  try {
    const superA = await userIdByEmail(db, 'parity+a-super_admin@tims.test');
    const hrA = await userIdByEmail(db, 'parity+a-hr_admin@tims.test');
    const hrbpA = await userIdByEmail(db, 'parity+a-hrbp@tims.test');
    const bSuper = await userIdByEmail(db, 'parity+b-super_admin@tims.test');
    const assignmentIdByCycleRater = async (cycleId: string, raterId: string): Promise<string> => {
      const { rows } = await db.query<IdRow>(
        `SELECT id FROM rater_assignments WHERE cycle_id = $1 AND rater_user_id = $2 AND status = 'pending' LIMIT 1`,
        [cycleId, raterId]
      );
      if (!rows.length) throw new Error(`resolveEvaluation360WriteResources: no pending assignment for rater ${raterId} in cycle ${cycleId} — run \`seed --teardown\` then \`seed\` (a submit consumes it)`);
      return rows[0].id;
    };
    return {
      userIdByRole: { super_admin: superA, hr_admin: hrA, hrbp: hrbpA },
      subjectA: hrA,
      submitAssignA: await assignmentIdByCycleRater(WRITE_EVAL_CYCLES.submitA, superA),
      submitAssignB: await assignmentIdByCycleRater(WRITE_EVAL_CYCLES.submitB, bSuper),
    };
  } finally {
    await db.end();
  }
}

// ── succession write-verification preconditions ──────────────────────────────
// The succession write surface (5 writes) needs by-id parent roles + successors the delete/update
// endpoints can target. DISTINCT fixed-UUID critical roles per endpoint (prefix e0000363…, disjoint
// from the read succession fixtures) + fixed successors (resolved by natural key), one per org
// (org-A = parity/rbac-deny target, org-B = IDOR target). addCriticalRole (a create) has no fixed
// precondition — its parity creates a marker-titled role (cleaned each run). Kept out of the shared
// read seed. All swept by teardown (which deletes successors/critical_roles by org, both orgs).

/** Write-verify-only critical-role fixtures (fixed UUIDs, disjoint from the read succession set). */
export const WRITE_SUCCESSION_ROLES = {
  addA: 'e0000363-0000-4000-8000-000000000001', // addSuccessor parent (org A)
  removeA: 'e0000363-0000-4000-8000-000000000002', // removeSuccessor parent (org A)
  removeB: 'e0000363-0000-4000-8000-000000000003', // removeSuccessor parent (org B — IDOR)
  readinessA: 'e0000363-0000-4000-8000-000000000004', // updateReadiness parent (org A)
  readinessB: 'e0000363-0000-4000-8000-000000000005', // updateReadiness parent (org B — IDOR)
  bandA: 'e0000363-0000-4000-8000-000000000006', // updateBand target (org A)
  bandB: 'e0000363-0000-4000-8000-000000000007', // updateBand target (org B — IDOR)
} as const;

/** The addCriticalRole marker title — the create's parity/deny rows self-locate by it. */
export const WRITE_SUCCESSION_CR_MARKER = 'Parity Write CR';

const WRITE_SUCCESSION_ROLE_IDS = Object.values(WRITE_SUCCESSION_ROLES);

/** Minimal critical_roles upsert (fixed id): sets org + title + criticality + target_band_level +
 *  holder, RESETTING target_band_level on conflict (so a re-run without teardown restores the band
 *  from-state for updateCriticalRoleBand). */
async function upsertWriteCriticalRole(
  db: Client, id: string, orgId: string, title: string, criticality: string,
  targetBand: string | null, holderId: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO critical_roles (id, organization_id, title, criticality, target_band_level, current_holder_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id, title = EXCLUDED.title, criticality = EXCLUDED.criticality,
       target_band_level = EXCLUDED.target_band_level, current_holder_id = EXCLUDED.current_holder_id, updated_at = now()`,
    [id, orgId, title, criticality, targetBand, holderId]
  );
}

/** Successor upsert, RESETTING readiness on conflict (updateReadiness from-state) — natural key
 *  (critical_role_id, user_id). Returns nothing; ids resolve by that natural key at check time. */
async function upsertWriteSuccessor(
  db: Client, orgId: string, criticalRoleId: string, userId: string, readiness: string, addedBy: string
): Promise<void> {
  await db.query(
    `INSERT INTO successors (id, organization_id, critical_role_id, user_id, readiness, type, added_by_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'internal', $5, now())
     ON CONFLICT (critical_role_id, user_id) DO UPDATE SET readiness = EXCLUDED.readiness, updated_at = now()`,
    [orgId, criticalRoleId, userId, readiness, addedBy]
  );
}

/** Seeds the succession write-verify preconditions (fresh each run: deletes prior write successors +
 *  the addCriticalRole marker rows, then re-seeds the fixed parent roles + successors). */
export async function seedSuccessionWritePreconditions(
  db: Client, orgAId: string, orgBId: string, userIds: Map<string, string>
): Promise<void> {
  const superA = userIds.get('a:super_admin');
  const hrA = userIds.get('a:hr_admin');
  const bSuper = userIds.get('b:super_admin');
  const bHr = userIds.get('b:hr_admin');
  if (!superA || !hrA || !bSuper || !bHr) return;

  // 1. Cleanup: successors of the write roles (FK→critical_roles) first, then the addCriticalRole
  //    marker rows (both orgs) — so removeSuccessor's target is restored and createCritical starts clean.
  await db.query('DELETE FROM successors WHERE critical_role_id = ANY($1)', [WRITE_SUCCESSION_ROLE_IDS]);
  await db.query(
    'DELETE FROM successors WHERE organization_id = ANY($1) AND critical_role_id IN (SELECT id FROM critical_roles WHERE title = $2)',
    [[orgAId, orgBId], WRITE_SUCCESSION_CR_MARKER]
  );
  await db.query(
    'DELETE FROM critical_roles WHERE organization_id = ANY($1) AND title = $2',
    [[orgAId, orgBId], WRITE_SUCCESSION_CR_MARKER]
  );

  // 2. Fixed parent critical roles (org A = parity/deny target, org B = IDOR target). bandA seeds a
  //    NULL band as the updateBand from-state; bandB seeds a distinct value so an IDOR leak is visible.
  await upsertWriteCriticalRole(db, WRITE_SUCCESSION_ROLES.addA, orgAId, 'Parity Write Succ AddA', 'high', null, superA);
  await upsertWriteCriticalRole(db, WRITE_SUCCESSION_ROLES.removeA, orgAId, 'Parity Write Succ RemoveA', 'high', null, superA);
  await upsertWriteCriticalRole(db, WRITE_SUCCESSION_ROLES.removeB, orgBId, 'Parity Write Succ RemoveB', 'high', null, bSuper);
  await upsertWriteCriticalRole(db, WRITE_SUCCESSION_ROLES.readinessA, orgAId, 'Parity Write Succ ReadinessA', 'high', null, superA);
  await upsertWriteCriticalRole(db, WRITE_SUCCESSION_ROLES.readinessB, orgBId, 'Parity Write Succ ReadinessB', 'high', null, bSuper);
  await upsertWriteCriticalRole(db, WRITE_SUCCESSION_ROLES.bandA, orgAId, 'Parity Write Succ BandA', 'high', null, superA);
  await upsertWriteCriticalRole(db, WRITE_SUCCESSION_ROLES.bandB, orgBId, 'Parity Write Succ BandB', 'high', 'ORGB-BAND', bSuper);

  // 3. Fixed successors (resolved by natural key at check time). removeA/B = delete targets;
  //    readinessA/B seed the 'developing' from-state (parity transitions to 'ready_now').
  await upsertWriteSuccessor(db, orgAId, WRITE_SUCCESSION_ROLES.removeA, hrA, 'ready_now', superA);
  await upsertWriteSuccessor(db, orgBId, WRITE_SUCCESSION_ROLES.removeB, bHr, 'ready_now', bSuper);
  await upsertWriteSuccessor(db, orgAId, WRITE_SUCCESSION_ROLES.readinessA, hrA, 'developing', superA);
  await upsertWriteSuccessor(db, orgBId, WRITE_SUCCESSION_ROLES.readinessB, bHr, 'developing', bSuper);
}

/** Resolved-id shape for the succession write surface (Omit<SuccessionWriteResolved,'base'>). */
export interface SuccessionWriteResources {
  userIdByRole: Record<string, string>;
  subjectA: string;
  subjectB: string;
  successorRemoveA: string;
  successorRemoveB: string;
  successorReadinessA: string;
  successorReadinessB: string;
}

/** The surface's ensurePreconditions hook. */
export async function ensureSuccessionWritePreconditions(cfg: HarnessConfig): Promise<void> {
  const db = makeDbClient(cfg);
  await db.connect();
  try {
    const orgA = await orgIdBySlug(db, ORG_SLUGS.a);
    const orgB = await orgIdBySlug(db, ORG_SLUGS.b);
    const userIds = new Map<string, string>([
      ['a:super_admin', await userIdByEmail(db, 'parity+a-super_admin@tims.test')],
      ['a:hr_admin', await userIdByEmail(db, 'parity+a-hr_admin@tims.test')],
      ['b:super_admin', await userIdByEmail(db, 'parity+b-super_admin@tims.test')],
      ['b:hr_admin', await userIdByEmail(db, 'parity+b-hr_admin@tims.test')],
    ]);
    await seedSuccessionWritePreconditions(db, orgA, orgB, userIds);
  } finally {
    await db.end();
  }
}

/** The surface's resolveResources hook. Successor ids (gen_random_uuid) resolve by natural key
 *  (critical_role + user); the fixed parent-role ids are constants the registry references directly. */
export async function resolveSuccessionWriteResources(cfg: HarnessConfig): Promise<SuccessionWriteResources> {
  const db = makeDbClient(cfg);
  await db.connect();
  try {
    const superA = await userIdByEmail(db, 'parity+a-super_admin@tims.test');
    const hrA = await userIdByEmail(db, 'parity+a-hr_admin@tims.test');
    const hrbpA = await userIdByEmail(db, 'parity+a-hrbp@tims.test');
    const bHr = await userIdByEmail(db, 'parity+b-hr_admin@tims.test');
    const successorId = async (criticalRoleId: string, userId: string): Promise<string> => {
      const { rows } = await db.query<IdRow>(
        `SELECT id FROM successors WHERE critical_role_id = $1 AND user_id = $2 LIMIT 1`,
        [criticalRoleId, userId]
      );
      if (!rows.length) throw new Error(`resolveSuccessionWriteResources: no successor for user ${userId} in role ${criticalRoleId} — run \`seed --teardown\` then \`seed\` (a remove consumes it)`);
      return rows[0].id;
    };
    return {
      userIdByRole: { super_admin: superA, hr_admin: hrA, hrbp: hrbpA },
      subjectA: hrA,
      subjectB: bHr,
      successorRemoveA: await successorId(WRITE_SUCCESSION_ROLES.removeA, hrA),
      successorRemoveB: await successorId(WRITE_SUCCESSION_ROLES.removeB, bHr),
      successorReadinessA: await successorId(WRITE_SUCCESSION_ROLES.readinessA, hrA),
      successorReadinessB: await successorId(WRITE_SUCCESSION_ROLES.readinessB, bHr),
    };
  } finally {
    await db.end();
  }
}

// ── Tier-2 by-id resource resolution ─────────────────────────────────────────
// `verify`/`rls`/`parity`/`rbac` run in a SEPARATE process from `seed`, so the by-id
// resource ids must be re-derivable at check time, not carried from a prior seed.
// Cycle ids are fixed constants (EVAL_CYCLE); the employee user ids resolve by their
// deterministic seeded email; the calibration session + critical role resolve by the
// same natural keys the seed find-or-creates them under (avoids a fixed-id migration
// of any pre-existing random-id rows). Read-only — no writes.
export interface ResourcePair {
  /** org-A id — substituted into the by-id path + tRPC input for parity/RBAC. */
  a: string;
  /** org-B id — the cross-tenant target for the RLS Mode-A IDOR probe. */
  b: string;
}
export interface SeedResources {
  employee: ResourcePair;
  'eval-cycle-staff': ResourcePair;
  'eval-cycle-self': ResourcePair;
  calibration: ResourcePair;
  'critical-role': ResourcePair;
}

async function orgIdBySlug(db: Client, slug: string): Promise<string> {
  const { rows } = await db.query<IdRow>('SELECT id FROM organizations WHERE slug = $1 LIMIT 1', [slug]);
  if (!rows.length) throw new Error(`resolveResources: org "${slug}" not found — run \`cli.ts seed\` first`);
  return rows[0].id;
}
async function userIdByEmail(db: Client, email: string): Promise<string> {
  const { rows } = await db.query<IdRow>('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
  if (!rows.length) throw new Error(`resolveResources: no seeded user "${email}" — run \`cli.ts seed\` first`);
  return rows[0].id;
}
async function calibrationIdByOrg(db: Client, orgId: string): Promise<string> {
  const { rows } = await db.query<IdRow>(
    `SELECT id FROM calibration_sessions WHERE organization_id = $1 AND period = '2026-Q1' LIMIT 1`,
    [orgId]
  );
  if (!rows.length) throw new Error(`resolveResources: no seeded calibration session in org ${orgId} — run \`cli.ts seed\` first`);
  return rows[0].id;
}
async function criticalRoleIdByOrgTitle(db: Client, orgId: string, title: string): Promise<string> {
  const { rows } = await db.query<IdRow>(
    'SELECT id FROM critical_roles WHERE organization_id = $1 AND title = $2 LIMIT 1',
    [orgId, title]
  );
  if (!rows.length) throw new Error(`resolveResources: no seeded critical role "${title}" in org ${orgId} — run \`cli.ts seed\` first`);
  return rows[0].id;
}

/** Resolves the Tier-2 by-id resource id pairs from the live seeded DB (read-only). */
export async function resolveResources(cfg: HarnessConfig): Promise<SeedResources> {
  const db = makeDbClient(cfg);
  await db.connect();
  try {
    const orgA = await orgIdBySlug(db, ORG_SLUGS.a);
    const orgB = await orgIdBySlug(db, ORG_SLUGS.b);
    return {
      employee: {
        a: await userIdByEmail(db, 'parity+a-hr_admin@tims.test'),
        b: await userIdByEmail(db, 'parity+b-hr_admin@tims.test'),
      },
      'eval-cycle-staff': { a: EVAL_CYCLE.openA, b: EVAL_CYCLE.openB },
      'eval-cycle-self': { a: EVAL_CYCLE.pubA, b: EVAL_CYCLE.pubB },
      calibration: { a: await calibrationIdByOrg(db, orgA), b: await calibrationIdByOrg(db, orgB) },
      'critical-role': {
        a: await criticalRoleIdByOrgTitle(db, orgA, 'Parity Critical Role A1'),
        b: await criticalRoleIdByOrgTitle(db, orgB, 'Parity Critical Role B1'),
      },
    };
  } finally {
    await db.end();
  }
}

/** Opens a read-only DB handle (the BYPASSRLS `postgres` client) for the write checks'
 *  read-backs. Returns a parameterized-query fn + a closer; the caller MUST call close(). */
export async function openReadback(
  cfg: HarnessConfig
): Promise<{ readback: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>; close: () => Promise<void> }> {
  const db = makeDbClient(cfg);
  await db.connect();
  return {
    readback: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    close: () => db.end().then(() => undefined),
  };
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

    // reporting RLS/RBAC/parity fixtures: vacancy:read grants (hr_admin@org / hrbp@unit)
    // + a recruitment dataset in org A only. Grants only when those roles were seeded.
    if (roles.includes('hr_admin') || roles.includes('hrbp')) await seedReportingGrants(db, roleIds);
    await seedReportingData(db, orgIds.a, userIds);

    // compensation fixtures (grants + org-A dataset). MUST run before succession's seed reads
    // (succession comp-gap reuses a comp row here). Grants only when those roles were seeded.
    if (roles.includes('hr_admin') || roles.includes('hrbp')) await seedCompensationGrants(db, roleIds);
    await seedCompensationData(db, orgIds.a, userIds);

    // evaluation360 fixtures (hr_admin grant + org-A cycles/assignments/response).
    if (roles.includes('hr_admin')) await seedEvaluation360Grants(db, roleIds);
    await seedEvaluation360Data(db, orgIds.a, userIds);

    // nine-box fixtures (grants + org-A evaluations/calibration).
    if (roles.includes('hr_admin') || roles.includes('hrbp')) await seedNineBoxGrants(db, roleIds);
    await seedNineBoxData(db, orgIds.a, userIds);

    // succession fixtures (grants + org-A critical roles/successor). AFTER compensation (comp-gap reuse).
    if (roles.includes('hr_admin') || roles.includes('hrbp')) await seedSuccessionGrants(db, roleIds);
    await seedSuccessionData(db, orgIds.a, userIds);

    // Tier-2 by-id ORG-B mirrors: make each by-id resource LIVE in org B so the RLS Mode-A IDOR
    // positive control (org-B super_admin reaches its own resource → 200) can distinguish a real
    // isolation pass from a trivial 404. Additive to the org-A-only Tier-1 fixtures above.
    await seedOrgBTier2Mirrors(db, orgIds.b, userIds);

    // NOTE: the write-verification org-B pending adjustment is deliberately NOT seeded here.
    // The read `pending-adjustments` RLS is a Mode-B check whose leak sensitivity depends on
    // org B being EMPTY for salary_adjustments (an additive read-leak → org B echoes org A →
    // identical-non-empty → FAIL). Seeding an org-B row would mask that. The write-IDOR target
    // is instead seeded by `ensureWritePreconditions` in the write-verify path only.
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
      // reporting fixture (org A only). MUST precede the users delete below (vacancy.created_by/
      // assigned_to + offer.created_by_id → users). FK order: offers → applications → pipeline_stages
      // → vacancies (candidate is Restrict, deleted last). Vacancy cascade would cover stages/apps/
      // offers on the org delete, but sweep explicitly so a teardown-without-reseed leaves nothing.
      const repVac = await db.query<IdRow>('SELECT id FROM vacancies WHERE organization_id = ANY($1)', [orgIds]);
      const repVacIds = repVac.rows.map((r) => r.id);
      if (repVacIds.length) {
        await db.query('DELETE FROM offers WHERE vacancy_id = ANY($1)', [repVacIds]);
        await db.query('DELETE FROM applications WHERE vacancy_id = ANY($1)', [repVacIds]);
        await db.query('DELETE FROM pipeline_stages WHERE vacancy_id = ANY($1)', [repVacIds]);
        await db.query('DELETE FROM vacancies WHERE id = ANY($1)', [repVacIds]);
      }
      // Scope to the reporting fixture candidates by their deterministic emails, so this can
      // never collide with a future surface that seeds candidates carrying dependent rows.
      await db.query(
        `DELETE FROM candidates WHERE organization_id = ANY($1) AND email LIKE 'parity+%-cand%@tims.test'`,
        [orgIds]
      );
      // compensation fixture (org A). All FK→users → must precede the users delete (step 3).
      await db.query('DELETE FROM salary_adjustments WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM benefit_enrollments WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM benefit_plans WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM employee_compensations WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM salary_bands WHERE organization_id = ANY($1)', [orgIds]);
      // evaluation360 fixture (org A). rater_assignments FK→users → precede the users delete.
      await db.query('DELETE FROM rater_responses WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM rater_assignments WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM review_cycles WHERE organization_id = ANY($1)', [orgIds]);
      // nine-box fixture (org A). calibration_members/votes are session-linked (no org_id) → delete
      // by session id first; evaluations/sessions/members/votes all FK→users → precede the users delete.
      const nbSess = await db.query<IdRow>('SELECT id FROM calibration_sessions WHERE organization_id = ANY($1)', [orgIds]);
      const nbSessIds = nbSess.rows.map((r) => r.id);
      if (nbSessIds.length) {
        await db.query('DELETE FROM calibration_votes WHERE session_id = ANY($1)', [nbSessIds]);
        await db.query('DELETE FROM calibration_members WHERE session_id = ANY($1)', [nbSessIds]);
      }
      await db.query('DELETE FROM calibration_sessions WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM nine_box_evaluations WHERE organization_id = ANY($1)', [orgIds]);
      // succession fixture (org A). successors/critical_roles FK→users → precede the users delete.
      await db.query('DELETE FROM successors WHERE organization_id = ANY($1)', [orgIds]);
      await db.query('DELETE FROM critical_roles WHERE organization_id = ANY($1)', [orgIds]);
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
