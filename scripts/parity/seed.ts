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
import type { AuthError, AuthUser, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { HarnessConfig } from './config';
import { makeAdminClient } from './supabase';

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

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === '23505';
}

function isEmailAlreadyRegistered(error: AuthError): boolean {
  return error.code === 'email_exists' || /already.*(registered|exists)/i.test(error.message);
}

/** Insert-or-find an organization by slug. Returns its DB id. */
async function upsertOrg(admin: SupabaseClient, slug: string): Promise<string> {
  const inserted = await admin
    .from('organizations')
    .insert({ name: `TIMS Parity Harness (${slug})`, slug })
    .select('id')
    .single();
  if (!inserted.error) return (inserted.data as IdRow).id;
  if (!isUniqueViolation(inserted.error)) throw inserted.error;
  const existing = await admin.from('organizations').select('id').eq('slug', slug).single();
  if (existing.error) throw existing.error;
  return (existing.data as IdRow).id;
}

/** Insert-or-find a per-org Role by (organization_id, slug). Returns its DB id. */
async function upsertRole(admin: SupabaseClient, organizationId: string, roleSlug: string): Promise<string> {
  const inserted = await admin
    .from('roles')
    .insert({ organization_id: organizationId, name: roleSlug, slug: roleSlug, is_system: true })
    .select('id')
    .single();
  if (!inserted.error) return (inserted.data as IdRow).id;
  if (!isUniqueViolation(inserted.error)) throw inserted.error;
  const existing = await admin
    .from('roles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', roleSlug)
    .single();
  if (existing.error) throw existing.error;
  return (existing.data as IdRow).id;
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
  admin: SupabaseClient,
  authUserId: string,
  organizationId: string,
  email: string,
  role: string
): Promise<string> {
  const inserted = await admin
    .from('users')
    .insert({
      supabase_user_id: authUserId,
      organization_id: organizationId,
      email,
      first_name: 'Parity',
      last_name: role,
    })
    .select('id')
    .single();
  if (!inserted.error) return (inserted.data as IdRow).id;
  if (!isUniqueViolation(inserted.error)) throw inserted.error;
  const existing = await admin.from('users').select('id').eq('supabase_user_id', authUserId).single();
  if (existing.error) throw existing.error;
  return (existing.data as IdRow).id;
}

/** Insert-or-ignore the user_roles grant row. */
async function upsertUserRoleGrant(admin: SupabaseClient, userId: string, roleId: string): Promise<void> {
  const { error } = await admin.from('user_roles').insert({ user_id: userId, role_id: roleId });
  if (error && !isUniqueViolation(error)) throw error;
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
  const plan = planSeed(roles);

  const orgIds = { a: '', b: '' } as Record<'a' | 'b', string>;
  for (const key of ORG_KEYS) orgIds[key] = await upsertOrg(admin, ORG_SLUGS[key]);

  const roleIds = new Map<string, string>();
  for (const key of ORG_KEYS)
    for (const role of roles) roleIds.set(`${key}:${role}`, await upsertRole(admin, orgIds[key], role));

  for (const u of plan.users) {
    const authUserId = await upsertAuthUser(admin, u.email, u.password);
    const userId = await upsertPublicUser(admin, authUserId, orgIds[u.orgKey], u.email, u.role);
    const roleId = roleIds.get(`${u.orgKey}:${u.role}`);
    if (!roleId) throw new Error(`seed: no planned role id for ${u.orgKey}:${u.role}`);
    await upsertUserRoleGrant(admin, userId, roleId);
  }

  return { orgs: orgIds, users: plan.users };
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
  const slugs = ORG_KEYS.map((k) => ORG_SLUGS[k]);

  const orgsRes = await admin.from('organizations').select('id').in('slug', slugs);
  if (orgsRes.error) throw orgsRes.error;
  const orgIds = (orgsRes.data as IdRow[]).map((r) => r.id);

  const parityAuthUsers = await findParityAuthUsers(admin);
  if (orgIds.length === 0 && parityAuthUsers.length === 0) return; // nothing seeded — idempotent no-op

  let userIds: string[] = [];
  let roleIds: string[] = [];
  if (orgIds.length) {
    const usersRes = await admin.from('users').select('id').in('organization_id', orgIds);
    if (usersRes.error) throw usersRes.error;
    userIds = (usersRes.data as IdRow[]).map((u) => u.id);

    const rolesRes = await admin.from('roles').select('id').in('organization_id', orgIds);
    if (rolesRes.error) throw rolesRes.error;
    roleIds = (rolesRes.data as IdRow[]).map((r) => r.id);
  }

  // 1. user_roles — child of both users and roles.
  if (userIds.length) {
    const { error } = await admin.from('user_roles').delete().in('user_id', userIds);
    if (error) throw error;
  }
  if (roleIds.length) {
    const { error } = await admin.from('user_roles').delete().in('role_id', roleIds);
    if (error) throw error;
  }

  // 2. roles — child of organizations.
  if (roleIds.length) {
    const { error } = await admin.from('roles').delete().in('id', roleIds);
    if (error) throw error;
  }

  // 3. public users — child of organizations.
  if (userIds.length) {
    const { error } = await admin.from('users').delete().in('id', userIds);
    if (error) throw error;
  }

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
  if (orgIds.length) {
    const { error } = await admin.from('organizations').delete().in('id', orgIds);
    if (error) throw error;
  }

  // After every deletion (DB rows + auth sweep) is attempted, surface any auth failure so the
  // caller learns of it — no orphan is left un-swept (a re-run still finds it via the sweep).
  const failures = deletions.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length) {
    const summary = failures
      .map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason)))
      .join('; ');
    throw new Error(`teardown: failed to delete ${failures.length} auth user(s): ${summary}`);
  }
}
