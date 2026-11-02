-- GENERATED FILE - do not edit. Source: scripts/db/backfills/288-org-roles-and-grants.sql (its CONNECTOR-APPLY section).
-- Regenerate: npx tsx scripts/db/backfills/generate-connector-applies.ts
--
-- Pure SQL for a connector that cannot run psql meta-commands: the same single transaction, guards
-- and assertions as the psql apply, with its psql variables inlined from the production dry run of
-- 2026-10-01:
--   expected_orgs = 1
-- Re-run the dry run first. If its totals differ, update CONNECTOR_INPUTS in connector-apply.ts and
-- regenerate; otherwise the apply aborts on the dry-run guard and nothing is written.
-- Send the WHOLE file as ONE request, as a BYPASSRLS role (postgres): the guard aborts otherwise.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL TimeZone = 'UTC';

SELECT set_config('backfill288.expected_orgs', '1', true);

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
