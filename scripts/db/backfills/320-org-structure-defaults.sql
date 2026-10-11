-- =====================================================================================================
-- #320 — Backfill the default org structure for existing organizations (one-off, idempotent)
-- =====================================================================================================
--
-- WHY. #310 makes vacancy approval leader/unit-scoped: a leader's or HRBP's scoped vacancy:approve
-- anchors to teams.leader_id, user_teams and user_business_units. Organizations created before
-- provisionOrgDefaults existed have no company / business unit / team at all, so there is nothing to
-- anchor to and nothing for admins to assign people into from Settings -> Business units.
--
-- WHAT NEW-COMPANY PROVISIONING CREATES — and therefore the ONLY thing this script creates:
--   packages/api/src/services/org-provisioning.ts provisionOrgDefaults (TS: self-serve signup,
--   platform org create, platform invitations) and its C# port
--   services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/OrgProvisioningWriter.cs
--   ProvisionDefaultsAsync (C# org creation) both write exactly:
--     companies       (organization_id, name = <the organization's name>, country = 'CO')
--     business_units  (organization_id, company_id = that company, name = 'General')
--     teams           (organization_id, business_unit_id = that unit, name = 'Equipo General')
--   Every other column is left to its DB default (currency 'USD', timezone 'America/Bogota',
--   language 'es', settings '{}', is_active true, created_at) or NULL (legal_name, tax_id, code,
--   parent_id, teams.leader_id). updated_at has no DB default and is set to now (UTC), as the
--   writers do.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * No leaders, no team members, no unit assignees, no users.business_unit_id. Provisioning assigns
--     NONE of these (teams.leader_id is NULL on every provisioned team; neither writer touches
--     user_teams or user_business_units), so a backfill that did would be inventing structure. Who
--     leads which team is a human decision — it is listed per org in REPORT 2 for the admins
--     (#320 option (a): Settings -> Business units).
--   * No vacancy.business_unit_id / team_id backfill — #320 leaves that as an owner decision; the
--     count of unplaced vacancies is in REPORT 2.
--   * No writes to an organization that has ANY company, business unit or team already. A partial
--     structure (e.g. a company with no unit) needs a human to say where the missing piece goes; it
--     is flagged in REPORT 1 as 'partial'.
--   * No writes to soft-deleted organizations (organizations.deleted_at IS NOT NULL).
--   * No roles / entitlements — provisionOrgRoles / provisionOrgEntitlements are out of scope.
--
-- TARGET ORG: deleted_at IS NULL AND it has zero companies AND zero business units AND zero teams.
--   (Inactive-but-not-deleted organizations are included — provisioning does not look at is_active —
--   and the dry run shows is_active so the owner can see them.)
--
-- HOW TO RUN (psql, as a BYPASSRLS role — the app's `postgres` login; companies / business_units /
-- teams are FORCE RLS, so any other role sees zero rows, every org looks empty, and the script would
-- create DUPLICATE structure. The apply section refuses to run without BYPASSRLS.)
--
--   1. Dry run (default; writes nothing):
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/db/backfills/320-org-structure-defaults.sql
--   2. Apply, passing the target-org total the dry run printed (rolls back if it differs):
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -v apply=true -v expected_orgs=<N> \
--             -f scripts/db/backfills/320-org-structure-defaults.sql
--   Re-running after a successful apply is a no-op: every org then has structure, the dry run shows
--   0 targets, and an apply with expected_orgs=0 writes nothing.
--
-- DRIFT GUARD: tests/db/backfill-defaults-pinned.test.ts asserts the three literals between the
-- BEGIN/END ORG_DEFAULTS markers equal what provisionOrgDefaults writes (TS) and the C#
-- OrgProvisioningWriter constants.
-- =====================================================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif

\echo '== #320 DRY RUN (read-only) =='

-- REPORT 1: per organization, current structure and what the apply would create.
--   structure_state: 'none'     -> gets company + 'General' + 'Equipo General' (1 row in each table)
--                    'complete' -> has company, unit and team; untouched
--                    'partial'  -> has some but not all; untouched, needs a human
--                    'deleted'  -> soft-deleted org; untouched
SELECT o.id AS organization_id, o.name AS organization, o.is_active,
       c.n AS companies, b.n AS business_units, t.n AS teams,
       CASE
         WHEN o.deleted_at IS NOT NULL               THEN 'deleted'
         WHEN c.n = 0 AND b.n = 0 AND t.n = 0        THEN 'none'
         WHEN c.n > 0 AND b.n > 0 AND t.n > 0        THEN 'complete'
         ELSE 'partial'
       END AS structure_state,
       CASE WHEN o.deleted_at IS NULL AND c.n = 0 AND b.n = 0 AND t.n = 0 THEN 1 ELSE 0 END AS companies_to_create,
       CASE WHEN o.deleted_at IS NULL AND c.n = 0 AND b.n = 0 AND t.n = 0 THEN 1 ELSE 0 END AS business_units_to_create,
       CASE WHEN o.deleted_at IS NULL AND c.n = 0 AND b.n = 0 AND t.n = 0 THEN 1 ELSE 0 END AS teams_to_create
FROM organizations o
CROSS JOIN LATERAL (SELECT count(*) AS n FROM companies x      WHERE x.organization_id = o.id) c
CROSS JOIN LATERAL (SELECT count(*) AS n FROM business_units x WHERE x.organization_id = o.id) b
CROSS JOIN LATERAL (SELECT count(*) AS n FROM teams x          WHERE x.organization_id = o.id) t
ORDER BY o.created_at;

-- TOTAL to pass as -v expected_orgs.
SELECT count(*) AS expected_orgs
FROM organizations o
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM companies x      WHERE x.organization_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM business_units x WHERE x.organization_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM teams x          WHERE x.organization_id = o.id);

-- REPORT 2 (needs human judgement — the script never writes any of this). Per non-deleted org:
--   active_teams_without_leader       teams.leader_id to set (Settings -> Business units)
--   active_users                      users with is_active AND deleted_at IS NULL
--   users_in_no_team / users_in_no_unit   candidates for user_teams / user_business_units
--   leader_role_users_unanchored      holders of an active 'leader' role (vacancy:approve scope=team)
--                                     who neither lead nor belong to an active team -> their scoped
--                                     approve currently covers nothing
--   hrbp_role_users_unanchored        holders of an active 'hrbp' role (unit-scoped) with no
--                                     user_business_units row and no user_roles.unit_scope
--   live_vacancies_unplaced           non-deleted vacancies with neither business_unit_id nor team_id
--                                     (only org-wide approvers can approve them; backfill = owner call)
SELECT o.id AS organization_id, o.name AS organization,
       (SELECT count(*) FROM teams t WHERE t.organization_id = o.id AND t.is_active AND t.leader_id IS NULL)
         AS active_teams_without_leader,
       (SELECT count(*) FROM users u WHERE u.organization_id = o.id AND u.is_active AND u.deleted_at IS NULL)
         AS active_users,
       (SELECT count(*) FROM users u WHERE u.organization_id = o.id AND u.is_active AND u.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id
                          WHERE ut.user_id = u.id AND t.organization_id = o.id))
         AS users_in_no_team,
       (SELECT count(*) FROM users u WHERE u.organization_id = o.id AND u.is_active AND u.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM user_business_units ub
                          WHERE ub.user_id = u.id AND ub.organization_id = o.id))
         AS users_in_no_unit,
       (SELECT count(DISTINCT u.id) FROM users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id AND r.organization_id = o.id AND r.slug = 'leader' AND r.is_active
        WHERE u.organization_id = o.id AND u.is_active AND u.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.leader_id = u.id AND t.is_active AND t.organization_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id
                          WHERE ut.user_id = u.id AND t.is_active AND t.organization_id = o.id))
         AS leader_role_users_unanchored,
       (SELECT count(DISTINCT u.id) FROM users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id AND r.organization_id = o.id AND r.slug = 'hrbp' AND r.is_active
        WHERE u.organization_id = o.id AND u.is_active AND u.deleted_at IS NULL AND ur.unit_scope IS NULL
          AND NOT EXISTS (SELECT 1 FROM user_business_units ub WHERE ub.user_id = u.id AND ub.organization_id = o.id))
         AS hrbp_role_users_unanchored,
       (SELECT count(*) FROM vacancies v WHERE v.organization_id = o.id AND v.deleted_at IS NULL
          AND v.business_unit_id IS NULL AND v.team_id IS NULL)
         AS live_vacancies_unplaced
FROM organizations o
WHERE o.deleted_at IS NULL
ORDER BY o.created_at;

\if :apply
\echo '== #320 APPLY (single transaction; any failed assertion rolls everything back) =='
\if :{?expected_orgs}
\else
  DO $abort$ BEGIN RAISE EXCEPTION '#320: -v expected_orgs=<N> is required with apply=true (copy it from the dry run)'; END $abort$;
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';

\o /dev/null
SELECT set_config('backfill320.expected_orgs', :'expected_orgs', true);
\o

DO $apply$
DECLARE
  -- BEGIN ORG_DEFAULTS
  c_country   CONSTANT text := 'CO';
  c_unit      CONSTANT text := 'General';
  c_team      CONSTANT text := 'Equipo General';
  -- END ORG_DEFAULTS
  v_expect    integer := current_setting('backfill320.expected_orgs')::integer;
  v_now       timestamp := now() AT TIME ZONE 'UTC';
  v_orgs      integer;
  v_n         integer;
  v_left      integer;
BEGIN
  -- Guard 1: these tables are FORCE RLS. Without BYPASSRLS every org would look empty and get a
  -- DUPLICATE structure.
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '#320: role % lacks BYPASSRLS; run as the app owner login (postgres)', current_user;
  END IF;

  -- Lock the candidate org rows. Any concurrent INSERT into companies / business_units / teams for
  -- one of them takes FOR KEY SHARE on the organization row (FK check), which conflicts with
  -- FOR UPDATE — so it either committed before this lock (and the NOT EXISTS below, evaluated in a
  -- fresh READ COMMITTED snapshot, sees it) or waits until we commit.
  PERFORM 1 FROM organizations o
  WHERE o.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM companies x WHERE x.organization_id = o.id)
  ORDER BY o.id
  FOR UPDATE;

  CREATE TEMP TABLE backfill320_targets ON COMMIT DROP AS
  SELECT o.id AS organization_id, o.name AS company_name,
         gen_random_uuid() AS company_id, gen_random_uuid() AS business_unit_id, gen_random_uuid() AS team_id
  FROM organizations o
  WHERE o.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM companies x      WHERE x.organization_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM business_units x WHERE x.organization_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM teams x          WHERE x.organization_id = o.id);
  GET DIAGNOSTICS v_orgs = ROW_COUNT;

  -- Guard 2: the operator's reviewed dry-run total must still be true.
  IF v_orgs <> v_expect THEN
    RAISE EXCEPTION '#320: % organizations now lack structure, dry run said % — re-run the dry run', v_orgs, v_expect;
  END IF;

  -- The NOT EXISTS re-checks make each insert a no-op on a re-run even if the target step changed.
  INSERT INTO companies (id, organization_id, name, country, updated_at)
  SELECT tg.company_id, tg.organization_id, tg.company_name, c_country, v_now
  FROM backfill320_targets tg
  WHERE NOT EXISTS (SELECT 1 FROM companies x WHERE x.organization_id = tg.organization_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_orgs THEN RAISE EXCEPTION '#320: inserted % companies, expected %', v_n, v_orgs; END IF;

  INSERT INTO business_units (id, organization_id, company_id, name, updated_at)
  SELECT tg.business_unit_id, tg.organization_id, tg.company_id, c_unit, v_now
  FROM backfill320_targets tg
  WHERE NOT EXISTS (SELECT 1 FROM business_units x WHERE x.organization_id = tg.organization_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_orgs THEN RAISE EXCEPTION '#320: inserted % business units, expected %', v_n, v_orgs; END IF;

  INSERT INTO teams (id, organization_id, business_unit_id, name, updated_at)
  SELECT tg.team_id, tg.organization_id, tg.business_unit_id, c_team, v_now
  FROM backfill320_targets tg
  WHERE NOT EXISTS (SELECT 1 FROM teams x WHERE x.organization_id = tg.organization_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_orgs THEN RAISE EXCEPTION '#320: inserted % teams, expected %', v_n, v_orgs; END IF;

  -- Guard 3: post-condition — every target now has exactly one of each, chained to each other, and
  -- no non-deleted org is left without a company.
  SELECT count(*) INTO v_n
  FROM backfill320_targets tg
  JOIN companies c      ON c.id = tg.company_id       AND c.organization_id = tg.organization_id
  JOIN business_units b ON b.id = tg.business_unit_id AND b.organization_id = tg.organization_id AND b.company_id = c.id
  JOIN teams t          ON t.id = tg.team_id          AND t.organization_id = tg.organization_id AND t.business_unit_id = b.id
                        AND t.leader_id IS NULL;
  IF v_n <> v_orgs THEN RAISE EXCEPTION '#320: read-back chained % of % targets', v_n, v_orgs; END IF;

  SELECT count(*) INTO v_left
  FROM organizations o
  WHERE o.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM companies x WHERE x.organization_id = o.id);
  IF v_left <> 0 THEN RAISE EXCEPTION '#320: % non-deleted organizations still have no company', v_left; END IF;

  RAISE NOTICE '#320 applied: % organizations provisioned (company + % + %), 0 leaders assigned', v_orgs, c_unit, c_team;
END
$apply$;

COMMIT;

\echo '== #320 READ-BACK (after commit) =='
SELECT o.id AS organization_id, o.name AS organization,
       (SELECT count(*) FROM companies x      WHERE x.organization_id = o.id) AS companies,
       (SELECT count(*) FROM business_units x WHERE x.organization_id = o.id) AS business_units,
       (SELECT count(*) FROM teams x          WHERE x.organization_id = o.id) AS teams,
       (SELECT count(*) FROM teams x          WHERE x.organization_id = o.id AND x.leader_id IS NOT NULL) AS teams_with_leader,
       (SELECT count(*) FROM user_business_units x WHERE x.organization_id = o.id) AS unit_assignees
FROM organizations o
WHERE o.deleted_at IS NULL
ORDER BY o.created_at;
\else
\echo '== DRY RUN ONLY — nothing was written. Re-run with -v apply=true -v expected_orgs=<N> to apply. =='
\endif
