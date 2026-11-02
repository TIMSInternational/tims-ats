-- =====================================================================================================
-- #288 — Backfill the default roles and grants for organizations that have NO roles (one-off, idempotent)
-- =====================================================================================================
--
-- WHY. An organization with zero rows in `roles` cannot give anyone a working role: every tenant
-- capability check resolves through roles -> role_permissions -> permissions, and the role pickers
-- list only that org's roles. New organizations get the full matrix at creation time — C#
-- RoleAccessProvisioner.ProvisionAsync (OrganizationBundleWriter: platform org create and
-- invitations) and TS provisionOrgRoles (self-serve signup). INVU was created by the seed
-- (packages/db/prisma/seed-entitlements.ts provisionInvu), which writes the organization and its
-- entitlements but no roles — it is a real customer org left with 0 roles.
--
-- WHAT IT CREATES — exactly what RoleAccessProvisioner.ProvisionAsync creates for a new org, from the
-- same data (services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/role-grants.json, embedded
-- below between the ROLE_GRANTS_JSON markers; that JSON is itself generated from
-- packages/db/prisma/seed-access-matrix.ts and drift-tested against it on the C# side):
--   permissions       one row per distinct (module, action) in the JSON that the GLOBAL catalog lacks,
--                     description = module || '.' || action (ON CONFLICT (module, action) DO NOTHING).
--                     Global, not per-org. Written only when at least one org is backfilled.
--   roles             one row per JSON role: name / slug / description from the JSON, is_system true;
--                     is_active left to its default (true). ON CONFLICT (organization_id, slug) DO NOTHING.
--   role_permissions  one row per JSON grant: the role's id, the (module, action) permission id, scope
--                     from the JSON. ON CONFLICT (role_id, permission_id) DO NOTHING.
--   created_at / updated_at are set explicitly to now (UTC); the apply also pins TimeZone = 'UTC'.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * No user_roles. Who holds super_admin / hr_admin / ... is a human decision (INVU has 0 users today).
--   * No writes to an org that already has ANY role. A partial matrix (e.g. the parity harness orgs,
--     which are fixtures with a deliberately reduced role set) is reported as 'partial' with its
--     missing / extra grant counts against the JSON, never written.
--   * No writes to soft-deleted organizations.
--   * No subscriptions / entitlements / org structure (see #320 for structure).
--
-- TARGET ORG (TARGET_PREDICATE): deleted_at IS NULL AND it has zero roles.
--
-- HOW TO RUN (psql, as a BYPASSRLS role — the app's `postgres` login; roles and role_permissions are
-- FORCE RLS, so any other role sees zero roles everywhere and the script would create DUPLICATE role
-- sets for every org. The apply section refuses to run without BYPASSRLS.)
--
--   1. Dry run (default; writes nothing):
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/db/backfills/288-org-roles-and-grants.sql
--   2. Apply, passing the target-org total the dry run printed (rolls back if it differs):
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -v apply=true -v expected_orgs=<N> \
--             -f scripts/db/backfills/288-org-roles-and-grants.sql
--   `apply` accepts exactly `true` or `false`; anything else aborts (exit 3).
--   Re-running after a successful apply is a no-op: every org then has roles, the dry run shows
--   0 targets, and an apply with expected_orgs=0 writes nothing.
--   No psql? apply-via-connector/288-org-roles-and-grants.sql is the same apply section, generated from
--   this file with the production dry-run total inlined (see generate-connector-applies.ts).
--
-- DRIFT GUARD: tests/db/backfill-defaults-pinned.test.ts asserts every ROLE_GRANTS_JSON block parses to
-- exactly role-grants.json, that the apply's spec-size guards equal its role / grant counts, and that
-- the dry run's TARGET_PREDICATE is the same text as the apply's.
-- =====================================================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif
SELECT (:'apply' IN ('true', 'false')) AS backfill_flags_valid \gset
\if :backfill_flags_valid
\else
  DO $abort$ BEGIN RAISE EXCEPTION '#288: -v apply must be exactly true or false'; END $abort$;
\endif

\echo '== #288 DRY RUN (read-only) =='

-- REPORT 1: per organization. state: 'none' -> gets the full role set; 'complete' -> exactly matches
-- the JSON; 'partial' -> has roles that differ from the JSON (untouched; missing/extra shown);
-- 'deleted' -> untouched. global_permissions_to_create is the same on every row (global catalog).
WITH spec AS (
  SELECT
-- BEGIN ROLE_GRANTS_JSON
$grants$
{"roles":[
{"slug":"super_admin","name":"Super Administrador","description":"Full access to all modules","grants":[{"module":"vacancy","action":"read","scope":"organization"},{"module":"vacancy","action":"create","scope":"organization"},{"module":"vacancy","action":"update","scope":"organization"},{"module":"vacancy","action":"delete","scope":"organization"},{"module":"pipeline","action":"read","scope":"organization"},{"module":"pipeline","action":"create","scope":"organization"},{"module":"pipeline","action":"update","scope":"organization"},{"module":"pipeline","action":"delete","scope":"organization"},{"module":"candidate","action":"read","scope":"organization"},{"module":"candidate","action":"create","scope":"organization"},{"module":"candidate","action":"update","scope":"organization"},{"module":"candidate","action":"delete","scope":"organization"},{"module":"assessment","action":"read","scope":"organization"},{"module":"assessment","action":"create","scope":"organization"},{"module":"assessment","action":"update","scope":"organization"},{"module":"assessment","action":"delete","scope":"organization"},{"module":"interview","action":"read","scope":"organization"},{"module":"interview","action":"create","scope":"organization"},{"module":"interview","action":"update","scope":"organization"},{"module":"interview","action":"delete","scope":"organization"},{"module":"offer","action":"read","scope":"organization"},{"module":"offer","action":"create","scope":"organization"},{"module":"offer","action":"update","scope":"organization"},{"module":"offer","action":"delete","scope":"organization"},{"module":"onboarding","action":"read","scope":"organization"},{"module":"onboarding","action":"create","scope":"organization"},{"module":"onboarding","action":"update","scope":"organization"},{"module":"onboarding","action":"delete","scope":"organization"},{"module":"performance","action":"read","scope":"organization"},{"module":"performance","action":"create","scope":"organization"},{"module":"performance","action":"update","scope":"organization"},{"module":"performance","action":"delete","scope":"organization"},{"module":"learning","action":"read","scope":"organization"},{"module":"learning","action":"create","scope":"organization"},{"module":"learning","action":"update","scope":"organization"},{"module":"learning","action":"delete","scope":"organization"},{"module":"ninebox","action":"read","scope":"organization"},{"module":"ninebox","action":"create","scope":"organization"},{"module":"ninebox","action":"update","scope":"organization"},{"module":"ninebox","action":"delete","scope":"organization"},{"module":"succession","action":"read","scope":"organization"},{"module":"succession","action":"create","scope":"organization"},{"module":"succession","action":"update","scope":"organization"},{"module":"succession","action":"delete","scope":"organization"},{"module":"team_intel","action":"read","scope":"organization"},{"module":"team_intel","action":"create","scope":"organization"},{"module":"team_intel","action":"update","scope":"organization"},{"module":"team_intel","action":"delete","scope":"organization"},{"module":"engagement","action":"read","scope":"organization"},{"module":"engagement","action":"create","scope":"organization"},{"module":"engagement","action":"update","scope":"organization"},{"module":"engagement","action":"delete","scope":"organization"},{"module":"dei","action":"read","scope":"organization"},{"module":"dei","action":"create","scope":"organization"},{"module":"dei","action":"update","scope":"organization"},{"module":"dei","action":"delete","scope":"organization"},{"module":"compensation","action":"read","scope":"organization"},{"module":"compensation","action":"create","scope":"organization"},{"module":"compensation","action":"update","scope":"organization"},{"module":"compensation","action":"delete","scope":"organization"},{"module":"monitoring","action":"read","scope":"organization"},{"module":"monitoring","action":"create","scope":"organization"},{"module":"monitoring","action":"update","scope":"organization"},{"module":"monitoring","action":"delete","scope":"organization"},{"module":"organization","action":"read","scope":"organization"},{"module":"organization","action":"create","scope":"organization"},{"module":"organization","action":"update","scope":"organization"},{"module":"organization","action":"delete","scope":"organization"},{"module":"user","action":"read","scope":"organization"},{"module":"user","action":"create","scope":"organization"},{"module":"user","action":"update","scope":"organization"},{"module":"user","action":"delete","scope":"organization"},{"module":"notification","action":"read","scope":"organization"},{"module":"notification","action":"create","scope":"organization"},{"module":"notification","action":"update","scope":"organization"},{"module":"notification","action":"delete","scope":"organization"},{"module":"audit","action":"read","scope":"organization"},{"module":"audit","action":"create","scope":"organization"},{"module":"audit","action":"update","scope":"organization"},{"module":"audit","action":"delete","scope":"organization"},{"module":"feature_flags","action":"read","scope":"organization"},{"module":"feature_flags","action":"create","scope":"organization"},{"module":"feature_flags","action":"update","scope":"organization"},{"module":"feature_flags","action":"delete","scope":"organization"},{"module":"billing","action":"read","scope":"organization"},{"module":"billing","action":"create","scope":"organization"},{"module":"billing","action":"update","scope":"organization"},{"module":"billing","action":"delete","scope":"organization"},{"module":"integration","action":"read","scope":"organization"},{"module":"integration","action":"create","scope":"organization"},{"module":"integration","action":"update","scope":"organization"},{"module":"integration","action":"delete","scope":"organization"},{"module":"fit_engine","action":"read","scope":"organization"},{"module":"fit_engine","action":"create","scope":"organization"},{"module":"fit_engine","action":"update","scope":"organization"},{"module":"fit_engine","action":"delete","scope":"organization"},{"module":"evaluation360","action":"read","scope":"organization"},{"module":"evaluation360","action":"create","scope":"organization"},{"module":"evaluation360","action":"update","scope":"organization"},{"module":"evaluation360","action":"delete","scope":"organization"},{"module":"vacancy","action":"approve","scope":"organization"},{"module":"vacancy","action":"publish","scope":"organization"},{"module":"offer","action":"approve","scope":"organization"},{"module":"compensation","action":"approve","scope":"organization"},{"module":"audit","action":"export","scope":"organization"},{"module":"dei","action":"export","scope":"organization"}]},
{"slug":"hr_admin","name":"Administrador RRHH","description":"Full access to all HR modules","grants":[{"module":"vacancy","action":"read","scope":"organization"},{"module":"vacancy","action":"create","scope":"organization"},{"module":"vacancy","action":"update","scope":"organization"},{"module":"vacancy","action":"delete","scope":"organization"},{"module":"pipeline","action":"read","scope":"organization"},{"module":"pipeline","action":"create","scope":"organization"},{"module":"pipeline","action":"update","scope":"organization"},{"module":"pipeline","action":"delete","scope":"organization"},{"module":"candidate","action":"read","scope":"organization"},{"module":"candidate","action":"create","scope":"organization"},{"module":"candidate","action":"update","scope":"organization"},{"module":"candidate","action":"delete","scope":"organization"},{"module":"assessment","action":"read","scope":"organization"},{"module":"assessment","action":"create","scope":"organization"},{"module":"assessment","action":"update","scope":"organization"},{"module":"assessment","action":"delete","scope":"organization"},{"module":"interview","action":"read","scope":"organization"},{"module":"interview","action":"create","scope":"organization"},{"module":"interview","action":"update","scope":"organization"},{"module":"interview","action":"delete","scope":"organization"},{"module":"offer","action":"read","scope":"organization"},{"module":"offer","action":"create","scope":"organization"},{"module":"offer","action":"update","scope":"organization"},{"module":"offer","action":"delete","scope":"organization"},{"module":"onboarding","action":"read","scope":"organization"},{"module":"onboarding","action":"create","scope":"organization"},{"module":"onboarding","action":"update","scope":"organization"},{"module":"onboarding","action":"delete","scope":"organization"},{"module":"performance","action":"read","scope":"organization"},{"module":"performance","action":"create","scope":"organization"},{"module":"performance","action":"update","scope":"organization"},{"module":"performance","action":"delete","scope":"organization"},{"module":"learning","action":"read","scope":"organization"},{"module":"learning","action":"create","scope":"organization"},{"module":"learning","action":"update","scope":"organization"},{"module":"learning","action":"delete","scope":"organization"},{"module":"ninebox","action":"read","scope":"organization"},{"module":"ninebox","action":"create","scope":"organization"},{"module":"ninebox","action":"update","scope":"organization"},{"module":"ninebox","action":"delete","scope":"organization"},{"module":"succession","action":"read","scope":"organization"},{"module":"succession","action":"create","scope":"organization"},{"module":"succession","action":"update","scope":"organization"},{"module":"succession","action":"delete","scope":"organization"},{"module":"team_intel","action":"read","scope":"organization"},{"module":"team_intel","action":"create","scope":"organization"},{"module":"team_intel","action":"update","scope":"organization"},{"module":"team_intel","action":"delete","scope":"organization"},{"module":"engagement","action":"read","scope":"organization"},{"module":"engagement","action":"create","scope":"organization"},{"module":"engagement","action":"update","scope":"organization"},{"module":"engagement","action":"delete","scope":"organization"},{"module":"compensation","action":"read","scope":"organization"},{"module":"compensation","action":"create","scope":"organization"},{"module":"compensation","action":"update","scope":"organization"},{"module":"compensation","action":"delete","scope":"organization"},{"module":"user","action":"read","scope":"organization"},{"module":"user","action":"create","scope":"organization"},{"module":"user","action":"update","scope":"organization"},{"module":"user","action":"delete","scope":"organization"},{"module":"notification","action":"read","scope":"organization"},{"module":"notification","action":"create","scope":"organization"},{"module":"notification","action":"update","scope":"organization"},{"module":"notification","action":"delete","scope":"organization"},{"module":"fit_engine","action":"read","scope":"organization"},{"module":"fit_engine","action":"create","scope":"organization"},{"module":"fit_engine","action":"update","scope":"organization"},{"module":"fit_engine","action":"delete","scope":"organization"},{"module":"evaluation360","action":"read","scope":"organization"},{"module":"evaluation360","action":"create","scope":"organization"},{"module":"evaluation360","action":"update","scope":"organization"},{"module":"evaluation360","action":"delete","scope":"organization"},{"module":"vacancy","action":"approve","scope":"organization"},{"module":"vacancy","action":"publish","scope":"organization"},{"module":"offer","action":"approve","scope":"organization"},{"module":"compensation","action":"approve","scope":"organization"},{"module":"dei","action":"read","scope":"organization"},{"module":"dei","action":"export","scope":"organization"},{"module":"monitoring","action":"read","scope":"organization"},{"module":"monitoring","action":"update","scope":"organization"},{"module":"organization","action":"read","scope":"organization"}]},
{"slug":"hrbp","name":"HR Business Partner","description":"Access to assigned business units","grants":[{"module":"vacancy","action":"read","scope":"unit"},{"module":"vacancy","action":"create","scope":"unit"},{"module":"vacancy","action":"update","scope":"unit"},{"module":"pipeline","action":"read","scope":"unit"},{"module":"pipeline","action":"update","scope":"unit"},{"module":"candidate","action":"read","scope":"unit"},{"module":"candidate","action":"update","scope":"unit"},{"module":"assessment","action":"read","scope":"unit"},{"module":"interview","action":"read","scope":"unit"},{"module":"interview","action":"create","scope":"unit"},{"module":"offer","action":"read","scope":"unit"},{"module":"onboarding","action":"read","scope":"unit"},{"module":"onboarding","action":"create","scope":"unit"},{"module":"onboarding","action":"update","scope":"unit"},{"module":"performance","action":"read","scope":"unit"},{"module":"performance","action":"update","scope":"unit"},{"module":"learning","action":"read","scope":"unit"},{"module":"ninebox","action":"read","scope":"unit"},{"module":"succession","action":"read","scope":"unit"},{"module":"engagement","action":"read","scope":"unit"},{"module":"compensation","action":"read","scope":"unit"},{"module":"monitoring","action":"read","scope":"unit"},{"module":"fit_engine","action":"read","scope":"unit"}]},
{"slug":"recruiter","name":"Reclutador","description":"ATS modules only","grants":[{"module":"pipeline","action":"read","scope":"organization"},{"module":"pipeline","action":"create","scope":"organization"},{"module":"pipeline","action":"update","scope":"organization"},{"module":"pipeline","action":"delete","scope":"organization"},{"module":"candidate","action":"read","scope":"organization"},{"module":"candidate","action":"create","scope":"organization"},{"module":"candidate","action":"update","scope":"organization"},{"module":"candidate","action":"delete","scope":"organization"},{"module":"interview","action":"read","scope":"organization"},{"module":"interview","action":"create","scope":"organization"},{"module":"interview","action":"update","scope":"organization"},{"module":"interview","action":"delete","scope":"organization"},{"module":"vacancy","action":"read","scope":"organization"},{"module":"vacancy","action":"create","scope":"organization"},{"module":"vacancy","action":"update","scope":"organization"},{"module":"vacancy","action":"delete","scope":"organization"},{"module":"vacancy","action":"publish","scope":"organization"},{"module":"assessment","action":"read","scope":"organization"},{"module":"assessment","action":"create","scope":"organization"},{"module":"assessment","action":"update","scope":"organization"},{"module":"offer","action":"read","scope":"organization"},{"module":"offer","action":"create","scope":"organization"},{"module":"fit_engine","action":"read","scope":"organization"},{"module":"fit_engine","action":"create","scope":"organization"}]},
{"slug":"leader","name":"Lider","description":"Own team and assigned vacancies","grants":[{"module":"vacancy","action":"read","scope":"team"},{"module":"vacancy","action":"create","scope":"team"},{"module":"vacancy","action":"approve","scope":"team"},{"module":"candidate","action":"read","scope":"team"},{"module":"pipeline","action":"read","scope":"team"},{"module":"pipeline","action":"update","scope":"team"},{"module":"interview","action":"read","scope":"team"},{"module":"interview","action":"create","scope":"team"},{"module":"interview","action":"update","scope":"team"},{"module":"offer","action":"read","scope":"team"},{"module":"offer","action":"approve","scope":"team"},{"module":"onboarding","action":"read","scope":"team"},{"module":"onboarding","action":"update","scope":"team"},{"module":"performance","action":"read","scope":"team"},{"module":"performance","action":"create","scope":"team"},{"module":"performance","action":"update","scope":"team"},{"module":"learning","action":"read","scope":"team"},{"module":"ninebox","action":"read","scope":"team"},{"module":"engagement","action":"read","scope":"team"},{"module":"compensation","action":"read","scope":"team"},{"module":"fit_engine","action":"read","scope":"team"}]},
{"slug":"committee","name":"Miembro de Comite","description":"Review panels only","grants":[{"module":"interview","action":"read","scope":"team"},{"module":"interview","action":"create","scope":"team"},{"module":"interview","action":"update","scope":"team"},{"module":"ninebox","action":"read","scope":"team"},{"module":"ninebox","action":"update","scope":"team"}]},
{"slug":"employee","name":"Colaborador","description":"Self-service access","grants":[{"module":"performance","action":"read","scope":"own"},{"module":"performance","action":"create","scope":"own"},{"module":"performance","action":"update","scope":"own"},{"module":"onboarding","action":"read","scope":"own"},{"module":"onboarding","action":"update","scope":"own"},{"module":"learning","action":"read","scope":"own"},{"module":"engagement","action":"read","scope":"own"},{"module":"engagement","action":"create","scope":"own"},{"module":"compensation","action":"read","scope":"own"}]},
{"slug":"external","name":"API Externa","description":"API access for integrations","grants":[{"module":"assessment","action":"read","scope":"organization"},{"module":"validation","action":"update","scope":"organization"}]},
{"slug":"candidate","name":"Candidato","description":"Portal access only","grants":[]}
]}
$grants$
-- END ROLE_GRANTS_JSON
  ::jsonb AS doc
),
spec_roles AS (
  SELECT r->>'slug' AS slug, r->'grants' AS grants FROM spec, jsonb_array_elements(spec.doc->'roles') r
),
spec_grants AS (
  SELECT sr.slug, g->>'module' AS module, g->>'action' AS action, g->>'scope' AS scope
  FROM spec_roles sr, jsonb_array_elements(sr.grants) g
),
actual AS (
  SELECT r.organization_id, r.slug, p.module, p.action, rp.scope
  FROM roles r
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.id = rp.permission_id
),
per_org AS (
  SELECT o.id, o.name, o.created_at, o.deleted_at,
         (SELECT count(*) FROM roles r WHERE r.organization_id = o.id) AS roles,
         (SELECT count(*) FROM actual a WHERE a.organization_id = o.id) AS role_grants,
         (SELECT count(*) FROM (SELECT slug FROM spec_roles
                                EXCEPT SELECT r.slug FROM roles r WHERE r.organization_id = o.id) m) AS missing_roles,
         (SELECT count(*) FROM (SELECT slug, module, action, scope FROM spec_grants
                                EXCEPT SELECT slug, module, action, scope FROM actual a WHERE a.organization_id = o.id) m) AS missing_grants,
         (SELECT count(*) FROM (SELECT slug, module, action, scope FROM actual a WHERE a.organization_id = o.id
                                EXCEPT SELECT slug, module, action, scope FROM spec_grants) x) AS extra_grants
  FROM organizations o
)
SELECT po.id AS organization_id, po.name AS organization, po.roles, po.role_grants,
       CASE
         WHEN po.deleted_at IS NOT NULL THEN 'deleted'
         WHEN po.roles = 0 THEN 'none'
         WHEN po.missing_roles = 0 AND po.missing_grants = 0 AND po.extra_grants = 0 THEN 'complete'
         ELSE 'partial'
       END AS state,
       CASE WHEN po.deleted_at IS NULL AND po.roles = 0 THEN (SELECT count(*) FROM spec_roles)  ELSE 0 END AS roles_to_create,
       CASE WHEN po.deleted_at IS NULL AND po.roles = 0 THEN (SELECT count(*) FROM spec_grants) ELSE 0 END AS grants_to_create,
       CASE WHEN po.roles = 0 THEN NULL ELSE po.missing_roles  END AS missing_roles_vs_spec,
       CASE WHEN po.roles = 0 THEN NULL ELSE po.missing_grants END AS missing_grants_vs_spec,
       CASE WHEN po.roles = 0 THEN NULL ELSE po.extra_grants   END AS extra_grants_vs_spec,
       (SELECT count(*) FROM (SELECT DISTINCT module, action FROM spec_grants) c
         WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module = c.module AND p.action = c.action))
         AS global_permissions_to_create
FROM per_org po
ORDER BY po.created_at;

-- TOTAL to pass as -v expected_orgs.
SELECT count(*) AS expected_orgs
FROM organizations o
-- BEGIN TARGET_PREDICATE
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM roles x WHERE x.organization_id = o.id)
-- END TARGET_PREDICATE
;

\if :apply
\echo '== #288 APPLY (single transaction; any failed assertion rolls everything back) =='
\if :{?expected_orgs}
\else
  DO $abort$ BEGIN RAISE EXCEPTION '#288: -v expected_orgs=<N> is required with apply=true (copy it from the dry run)'; END $abort$;
\endif

-- CONNECTOR-APPLY-BEGIN
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL TimeZone = 'UTC';

\o /dev/null
SELECT set_config('backfill288.expected_orgs', :'expected_orgs', true);
\o

CREATE TEMP TABLE backfill288_spec ON COMMIT DROP AS
SELECT
-- BEGIN ROLE_GRANTS_JSON
$grants$
{"roles":[
{"slug":"super_admin","name":"Super Administrador","description":"Full access to all modules","grants":[{"module":"vacancy","action":"read","scope":"organization"},{"module":"vacancy","action":"create","scope":"organization"},{"module":"vacancy","action":"update","scope":"organization"},{"module":"vacancy","action":"delete","scope":"organization"},{"module":"pipeline","action":"read","scope":"organization"},{"module":"pipeline","action":"create","scope":"organization"},{"module":"pipeline","action":"update","scope":"organization"},{"module":"pipeline","action":"delete","scope":"organization"},{"module":"candidate","action":"read","scope":"organization"},{"module":"candidate","action":"create","scope":"organization"},{"module":"candidate","action":"update","scope":"organization"},{"module":"candidate","action":"delete","scope":"organization"},{"module":"assessment","action":"read","scope":"organization"},{"module":"assessment","action":"create","scope":"organization"},{"module":"assessment","action":"update","scope":"organization"},{"module":"assessment","action":"delete","scope":"organization"},{"module":"interview","action":"read","scope":"organization"},{"module":"interview","action":"create","scope":"organization"},{"module":"interview","action":"update","scope":"organization"},{"module":"interview","action":"delete","scope":"organization"},{"module":"offer","action":"read","scope":"organization"},{"module":"offer","action":"create","scope":"organization"},{"module":"offer","action":"update","scope":"organization"},{"module":"offer","action":"delete","scope":"organization"},{"module":"onboarding","action":"read","scope":"organization"},{"module":"onboarding","action":"create","scope":"organization"},{"module":"onboarding","action":"update","scope":"organization"},{"module":"onboarding","action":"delete","scope":"organization"},{"module":"performance","action":"read","scope":"organization"},{"module":"performance","action":"create","scope":"organization"},{"module":"performance","action":"update","scope":"organization"},{"module":"performance","action":"delete","scope":"organization"},{"module":"learning","action":"read","scope":"organization"},{"module":"learning","action":"create","scope":"organization"},{"module":"learning","action":"update","scope":"organization"},{"module":"learning","action":"delete","scope":"organization"},{"module":"ninebox","action":"read","scope":"organization"},{"module":"ninebox","action":"create","scope":"organization"},{"module":"ninebox","action":"update","scope":"organization"},{"module":"ninebox","action":"delete","scope":"organization"},{"module":"succession","action":"read","scope":"organization"},{"module":"succession","action":"create","scope":"organization"},{"module":"succession","action":"update","scope":"organization"},{"module":"succession","action":"delete","scope":"organization"},{"module":"team_intel","action":"read","scope":"organization"},{"module":"team_intel","action":"create","scope":"organization"},{"module":"team_intel","action":"update","scope":"organization"},{"module":"team_intel","action":"delete","scope":"organization"},{"module":"engagement","action":"read","scope":"organization"},{"module":"engagement","action":"create","scope":"organization"},{"module":"engagement","action":"update","scope":"organization"},{"module":"engagement","action":"delete","scope":"organization"},{"module":"dei","action":"read","scope":"organization"},{"module":"dei","action":"create","scope":"organization"},{"module":"dei","action":"update","scope":"organization"},{"module":"dei","action":"delete","scope":"organization"},{"module":"compensation","action":"read","scope":"organization"},{"module":"compensation","action":"create","scope":"organization"},{"module":"compensation","action":"update","scope":"organization"},{"module":"compensation","action":"delete","scope":"organization"},{"module":"monitoring","action":"read","scope":"organization"},{"module":"monitoring","action":"create","scope":"organization"},{"module":"monitoring","action":"update","scope":"organization"},{"module":"monitoring","action":"delete","scope":"organization"},{"module":"organization","action":"read","scope":"organization"},{"module":"organization","action":"create","scope":"organization"},{"module":"organization","action":"update","scope":"organization"},{"module":"organization","action":"delete","scope":"organization"},{"module":"user","action":"read","scope":"organization"},{"module":"user","action":"create","scope":"organization"},{"module":"user","action":"update","scope":"organization"},{"module":"user","action":"delete","scope":"organization"},{"module":"notification","action":"read","scope":"organization"},{"module":"notification","action":"create","scope":"organization"},{"module":"notification","action":"update","scope":"organization"},{"module":"notification","action":"delete","scope":"organization"},{"module":"audit","action":"read","scope":"organization"},{"module":"audit","action":"create","scope":"organization"},{"module":"audit","action":"update","scope":"organization"},{"module":"audit","action":"delete","scope":"organization"},{"module":"feature_flags","action":"read","scope":"organization"},{"module":"feature_flags","action":"create","scope":"organization"},{"module":"feature_flags","action":"update","scope":"organization"},{"module":"feature_flags","action":"delete","scope":"organization"},{"module":"billing","action":"read","scope":"organization"},{"module":"billing","action":"create","scope":"organization"},{"module":"billing","action":"update","scope":"organization"},{"module":"billing","action":"delete","scope":"organization"},{"module":"integration","action":"read","scope":"organization"},{"module":"integration","action":"create","scope":"organization"},{"module":"integration","action":"update","scope":"organization"},{"module":"integration","action":"delete","scope":"organization"},{"module":"fit_engine","action":"read","scope":"organization"},{"module":"fit_engine","action":"create","scope":"organization"},{"module":"fit_engine","action":"update","scope":"organization"},{"module":"fit_engine","action":"delete","scope":"organization"},{"module":"evaluation360","action":"read","scope":"organization"},{"module":"evaluation360","action":"create","scope":"organization"},{"module":"evaluation360","action":"update","scope":"organization"},{"module":"evaluation360","action":"delete","scope":"organization"},{"module":"vacancy","action":"approve","scope":"organization"},{"module":"vacancy","action":"publish","scope":"organization"},{"module":"offer","action":"approve","scope":"organization"},{"module":"compensation","action":"approve","scope":"organization"},{"module":"audit","action":"export","scope":"organization"},{"module":"dei","action":"export","scope":"organization"}]},
{"slug":"hr_admin","name":"Administrador RRHH","description":"Full access to all HR modules","grants":[{"module":"vacancy","action":"read","scope":"organization"},{"module":"vacancy","action":"create","scope":"organization"},{"module":"vacancy","action":"update","scope":"organization"},{"module":"vacancy","action":"delete","scope":"organization"},{"module":"pipeline","action":"read","scope":"organization"},{"module":"pipeline","action":"create","scope":"organization"},{"module":"pipeline","action":"update","scope":"organization"},{"module":"pipeline","action":"delete","scope":"organization"},{"module":"candidate","action":"read","scope":"organization"},{"module":"candidate","action":"create","scope":"organization"},{"module":"candidate","action":"update","scope":"organization"},{"module":"candidate","action":"delete","scope":"organization"},{"module":"assessment","action":"read","scope":"organization"},{"module":"assessment","action":"create","scope":"organization"},{"module":"assessment","action":"update","scope":"organization"},{"module":"assessment","action":"delete","scope":"organization"},{"module":"interview","action":"read","scope":"organization"},{"module":"interview","action":"create","scope":"organization"},{"module":"interview","action":"update","scope":"organization"},{"module":"interview","action":"delete","scope":"organization"},{"module":"offer","action":"read","scope":"organization"},{"module":"offer","action":"create","scope":"organization"},{"module":"offer","action":"update","scope":"organization"},{"module":"offer","action":"delete","scope":"organization"},{"module":"onboarding","action":"read","scope":"organization"},{"module":"onboarding","action":"create","scope":"organization"},{"module":"onboarding","action":"update","scope":"organization"},{"module":"onboarding","action":"delete","scope":"organization"},{"module":"performance","action":"read","scope":"organization"},{"module":"performance","action":"create","scope":"organization"},{"module":"performance","action":"update","scope":"organization"},{"module":"performance","action":"delete","scope":"organization"},{"module":"learning","action":"read","scope":"organization"},{"module":"learning","action":"create","scope":"organization"},{"module":"learning","action":"update","scope":"organization"},{"module":"learning","action":"delete","scope":"organization"},{"module":"ninebox","action":"read","scope":"organization"},{"module":"ninebox","action":"create","scope":"organization"},{"module":"ninebox","action":"update","scope":"organization"},{"module":"ninebox","action":"delete","scope":"organization"},{"module":"succession","action":"read","scope":"organization"},{"module":"succession","action":"create","scope":"organization"},{"module":"succession","action":"update","scope":"organization"},{"module":"succession","action":"delete","scope":"organization"},{"module":"team_intel","action":"read","scope":"organization"},{"module":"team_intel","action":"create","scope":"organization"},{"module":"team_intel","action":"update","scope":"organization"},{"module":"team_intel","action":"delete","scope":"organization"},{"module":"engagement","action":"read","scope":"organization"},{"module":"engagement","action":"create","scope":"organization"},{"module":"engagement","action":"update","scope":"organization"},{"module":"engagement","action":"delete","scope":"organization"},{"module":"compensation","action":"read","scope":"organization"},{"module":"compensation","action":"create","scope":"organization"},{"module":"compensation","action":"update","scope":"organization"},{"module":"compensation","action":"delete","scope":"organization"},{"module":"user","action":"read","scope":"organization"},{"module":"user","action":"create","scope":"organization"},{"module":"user","action":"update","scope":"organization"},{"module":"user","action":"delete","scope":"organization"},{"module":"notification","action":"read","scope":"organization"},{"module":"notification","action":"create","scope":"organization"},{"module":"notification","action":"update","scope":"organization"},{"module":"notification","action":"delete","scope":"organization"},{"module":"fit_engine","action":"read","scope":"organization"},{"module":"fit_engine","action":"create","scope":"organization"},{"module":"fit_engine","action":"update","scope":"organization"},{"module":"fit_engine","action":"delete","scope":"organization"},{"module":"evaluation360","action":"read","scope":"organization"},{"module":"evaluation360","action":"create","scope":"organization"},{"module":"evaluation360","action":"update","scope":"organization"},{"module":"evaluation360","action":"delete","scope":"organization"},{"module":"vacancy","action":"approve","scope":"organization"},{"module":"vacancy","action":"publish","scope":"organization"},{"module":"offer","action":"approve","scope":"organization"},{"module":"compensation","action":"approve","scope":"organization"},{"module":"dei","action":"read","scope":"organization"},{"module":"dei","action":"export","scope":"organization"},{"module":"monitoring","action":"read","scope":"organization"},{"module":"monitoring","action":"update","scope":"organization"},{"module":"organization","action":"read","scope":"organization"}]},
{"slug":"hrbp","name":"HR Business Partner","description":"Access to assigned business units","grants":[{"module":"vacancy","action":"read","scope":"unit"},{"module":"vacancy","action":"create","scope":"unit"},{"module":"vacancy","action":"update","scope":"unit"},{"module":"pipeline","action":"read","scope":"unit"},{"module":"pipeline","action":"update","scope":"unit"},{"module":"candidate","action":"read","scope":"unit"},{"module":"candidate","action":"update","scope":"unit"},{"module":"assessment","action":"read","scope":"unit"},{"module":"interview","action":"read","scope":"unit"},{"module":"interview","action":"create","scope":"unit"},{"module":"offer","action":"read","scope":"unit"},{"module":"onboarding","action":"read","scope":"unit"},{"module":"onboarding","action":"create","scope":"unit"},{"module":"onboarding","action":"update","scope":"unit"},{"module":"performance","action":"read","scope":"unit"},{"module":"performance","action":"update","scope":"unit"},{"module":"learning","action":"read","scope":"unit"},{"module":"ninebox","action":"read","scope":"unit"},{"module":"succession","action":"read","scope":"unit"},{"module":"engagement","action":"read","scope":"unit"},{"module":"compensation","action":"read","scope":"unit"},{"module":"monitoring","action":"read","scope":"unit"},{"module":"fit_engine","action":"read","scope":"unit"}]},
{"slug":"recruiter","name":"Reclutador","description":"ATS modules only","grants":[{"module":"pipeline","action":"read","scope":"organization"},{"module":"pipeline","action":"create","scope":"organization"},{"module":"pipeline","action":"update","scope":"organization"},{"module":"pipeline","action":"delete","scope":"organization"},{"module":"candidate","action":"read","scope":"organization"},{"module":"candidate","action":"create","scope":"organization"},{"module":"candidate","action":"update","scope":"organization"},{"module":"candidate","action":"delete","scope":"organization"},{"module":"interview","action":"read","scope":"organization"},{"module":"interview","action":"create","scope":"organization"},{"module":"interview","action":"update","scope":"organization"},{"module":"interview","action":"delete","scope":"organization"},{"module":"vacancy","action":"read","scope":"organization"},{"module":"vacancy","action":"create","scope":"organization"},{"module":"vacancy","action":"update","scope":"organization"},{"module":"vacancy","action":"delete","scope":"organization"},{"module":"vacancy","action":"publish","scope":"organization"},{"module":"assessment","action":"read","scope":"organization"},{"module":"assessment","action":"create","scope":"organization"},{"module":"assessment","action":"update","scope":"organization"},{"module":"offer","action":"read","scope":"organization"},{"module":"offer","action":"create","scope":"organization"},{"module":"fit_engine","action":"read","scope":"organization"},{"module":"fit_engine","action":"create","scope":"organization"}]},
{"slug":"leader","name":"Lider","description":"Own team and assigned vacancies","grants":[{"module":"vacancy","action":"read","scope":"team"},{"module":"vacancy","action":"create","scope":"team"},{"module":"vacancy","action":"approve","scope":"team"},{"module":"candidate","action":"read","scope":"team"},{"module":"pipeline","action":"read","scope":"team"},{"module":"pipeline","action":"update","scope":"team"},{"module":"interview","action":"read","scope":"team"},{"module":"interview","action":"create","scope":"team"},{"module":"interview","action":"update","scope":"team"},{"module":"offer","action":"read","scope":"team"},{"module":"offer","action":"approve","scope":"team"},{"module":"onboarding","action":"read","scope":"team"},{"module":"onboarding","action":"update","scope":"team"},{"module":"performance","action":"read","scope":"team"},{"module":"performance","action":"create","scope":"team"},{"module":"performance","action":"update","scope":"team"},{"module":"learning","action":"read","scope":"team"},{"module":"ninebox","action":"read","scope":"team"},{"module":"engagement","action":"read","scope":"team"},{"module":"compensation","action":"read","scope":"team"},{"module":"fit_engine","action":"read","scope":"team"}]},
{"slug":"committee","name":"Miembro de Comite","description":"Review panels only","grants":[{"module":"interview","action":"read","scope":"team"},{"module":"interview","action":"create","scope":"team"},{"module":"interview","action":"update","scope":"team"},{"module":"ninebox","action":"read","scope":"team"},{"module":"ninebox","action":"update","scope":"team"}]},
{"slug":"employee","name":"Colaborador","description":"Self-service access","grants":[{"module":"performance","action":"read","scope":"own"},{"module":"performance","action":"create","scope":"own"},{"module":"performance","action":"update","scope":"own"},{"module":"onboarding","action":"read","scope":"own"},{"module":"onboarding","action":"update","scope":"own"},{"module":"learning","action":"read","scope":"own"},{"module":"engagement","action":"read","scope":"own"},{"module":"engagement","action":"create","scope":"own"},{"module":"compensation","action":"read","scope":"own"}]},
{"slug":"external","name":"API Externa","description":"API access for integrations","grants":[{"module":"assessment","action":"read","scope":"organization"},{"module":"validation","action":"update","scope":"organization"}]},
{"slug":"candidate","name":"Candidato","description":"Portal access only","grants":[]}
]}
$grants$
-- END ROLE_GRANTS_JSON
  ::jsonb AS doc;

DO $apply$
DECLARE
  v_expect        integer := current_setting('backfill288.expected_orgs')::integer;
  v_now           timestamp := now() AT TIME ZONE 'UTC';
  v_spec_roles    integer;
  v_spec_grants   integer;
  v_orgs          integer;
  v_perms_missing integer;
  v_n             integer;
BEGIN
  -- Guard 1: roles / role_permissions are FORCE RLS. Without BYPASSRLS every org would look role-less
  -- and get a DUPLICATE role set.
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '#288: role % lacks BYPASSRLS; run as the app owner login (postgres)', current_user;
  END IF;

  CREATE TEMP TABLE backfill288_roles ON COMMIT DROP AS
  SELECT r->>'slug' AS slug, r->>'name' AS name, r->>'description' AS description, r->'grants' AS grants
  FROM backfill288_spec s, jsonb_array_elements(s.doc->'roles') r;
  CREATE TEMP TABLE backfill288_grants ON COMMIT DROP AS
  SELECT sr.slug, g->>'module' AS module, g->>'action' AS action, g->>'scope' AS scope
  FROM backfill288_roles sr, jsonb_array_elements(sr.grants) g;

  -- Guard 2: the embedded spec is the whole matrix (a truncated paste fails here, not in prod data).
  SELECT count(*) INTO v_spec_roles FROM backfill288_roles;
  SELECT count(*) INTO v_spec_grants FROM backfill288_grants;
  IF v_spec_roles <> 9 OR v_spec_grants <> 271 THEN
    RAISE EXCEPTION '#288: embedded spec has % roles / % grants, expected 9 / 271', v_spec_roles, v_spec_grants;
  END IF;

  -- Lock the candidate org rows. roles.organization_id FKs organizations, so a concurrent role insert
  -- for a candidate org takes FOR KEY SHARE on its row and conflicts with this FOR UPDATE: it either
  -- committed before the lock (and the NOT EXISTS below, in a fresh READ COMMITTED snapshot, sees it)
  -- or waits until we commit. role_permissions rows can only hang off those roles.
  PERFORM 1 FROM organizations o
  WHERE o.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM roles x WHERE x.organization_id = o.id)
  ORDER BY o.id
  FOR UPDATE;

  CREATE TEMP TABLE backfill288_targets ON COMMIT DROP AS
  SELECT o.id AS organization_id
  FROM organizations o
-- BEGIN TARGET_PREDICATE
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM roles x WHERE x.organization_id = o.id)
-- END TARGET_PREDICATE
  ;
  GET DIAGNOSTICS v_orgs = ROW_COUNT;

  -- Guard 3: the operator's reviewed dry-run total must still be true.
  IF v_orgs <> v_expect THEN
    RAISE EXCEPTION '#288: % organizations now have no roles, dry run said % — re-run the dry run', v_orgs, v_expect;
  END IF;

  IF v_orgs > 0 THEN
    -- Global permission catalog: only the (module, action) pairs that are missing.
    SELECT count(*) INTO v_perms_missing
    FROM (SELECT DISTINCT module, action FROM backfill288_grants) c
    WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.module = c.module AND p.action = c.action);
    INSERT INTO permissions (id, module, action, description, created_at)
    SELECT gen_random_uuid(), c.module, c.action, c.module || '.' || c.action, v_now
    FROM (SELECT DISTINCT module, action FROM backfill288_grants) c
    ON CONFLICT (module, action) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_perms_missing THEN
      RAISE EXCEPTION '#288: inserted % permissions, expected %', v_n, v_perms_missing;
    END IF;

    INSERT INTO roles (id, organization_id, name, slug, description, is_system, created_at, updated_at)
    SELECT gen_random_uuid(), tg.organization_id, sr.name, sr.slug, sr.description, true, v_now, v_now
    FROM backfill288_targets tg
    CROSS JOIN backfill288_roles sr
    ON CONFLICT (organization_id, slug) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_orgs * v_spec_roles THEN
      RAISE EXCEPTION '#288: inserted % roles, expected % (% orgs x %)', v_n, v_orgs * v_spec_roles, v_orgs, v_spec_roles;
    END IF;

    INSERT INTO role_permissions (id, role_id, permission_id, scope, created_at)
    SELECT gen_random_uuid(), r.id, p.id, sg.scope, v_now
    FROM backfill288_targets tg
    JOIN roles r ON r.organization_id = tg.organization_id
    JOIN backfill288_grants sg ON sg.slug = r.slug
    JOIN permissions p ON p.module = sg.module AND p.action = sg.action
    ON CONFLICT (role_id, permission_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_orgs * v_spec_grants THEN
      RAISE EXCEPTION '#288: inserted % role grants, expected % (% orgs x %)', v_n, v_orgs * v_spec_grants, v_orgs, v_spec_grants;
    END IF;
  END IF;

  -- Guard 4: post-condition — every target org's (role, module, action, scope) set equals the spec
  -- exactly, in both directions, and every role is a system role.
  SELECT count(*) INTO v_n FROM (
    (SELECT tg.organization_id, sg.slug, sg.module, sg.action, sg.scope
       FROM backfill288_targets tg CROSS JOIN backfill288_grants sg
     EXCEPT
     SELECT r.organization_id, r.slug, p.module, p.action, rp.scope
       FROM backfill288_targets tg
       JOIN roles r ON r.organization_id = tg.organization_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id)
    UNION ALL
    (SELECT r.organization_id, r.slug, p.module, p.action, rp.scope
       FROM backfill288_targets tg
       JOIN roles r ON r.organization_id = tg.organization_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
     EXCEPT
     SELECT tg.organization_id, sg.slug, sg.module, sg.action, sg.scope
       FROM backfill288_targets tg CROSS JOIN backfill288_grants sg)
  ) diff;
  IF v_n <> 0 THEN RAISE EXCEPTION '#288: % grant rows differ from the spec after insert', v_n; END IF;

  SELECT count(*) INTO v_n
  FROM backfill288_targets tg JOIN roles r ON r.organization_id = tg.organization_id
  WHERE NOT r.is_system OR NOT r.is_active;
  IF v_n <> 0 THEN RAISE EXCEPTION '#288: % backfilled roles are not active system roles', v_n; END IF;

  SELECT count(*) INTO v_n
  FROM organizations o
  WHERE o.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM roles x WHERE x.organization_id = o.id);
  IF v_n <> 0 THEN RAISE EXCEPTION '#288: % non-deleted organizations still have no roles', v_n; END IF;

  RAISE NOTICE '#288 applied: % organizations x % roles / % grants; % permissions added to the catalog; 0 user_roles',
    v_orgs, v_spec_roles, v_spec_grants, COALESCE(v_perms_missing, 0);
END
$apply$;

COMMIT;

\echo '== #288 READ-BACK (after commit) =='
SELECT o.id AS organization_id, o.name AS organization,
       (SELECT count(*) FROM roles r WHERE r.organization_id = o.id)                         AS roles,
       (SELECT count(*) FROM roles r WHERE r.organization_id = o.id AND r.is_system)         AS system_roles,
       (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
         WHERE r.organization_id = o.id)                                                     AS role_grants,
       (SELECT count(*) FROM roles r WHERE r.organization_id = o.id
         AND r.created_at >= now() AT TIME ZONE 'UTC' - interval '10 minutes')               AS roles_created_last_10_min
FROM organizations o
WHERE o.deleted_at IS NULL
ORDER BY o.created_at;
-- CONNECTOR-APPLY-END
\else
\echo '== DRY RUN ONLY — nothing was written. Re-run with -v apply=true -v expected_orgs=<N> to apply. =='
\endif
