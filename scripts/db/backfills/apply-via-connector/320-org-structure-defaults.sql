-- GENERATED FILE - do not edit. Source: scripts/db/backfills/320-org-structure-defaults.sql (its CONNECTOR-APPLY section).
-- Regenerate: npx tsx scripts/db/backfills/generate-connector-applies.ts
--
-- Pure SQL for a connector that cannot run psql meta-commands: the same single transaction, guards
-- and assertions as the psql apply, with its psql variables inlined from the production dry run of
-- 2026-10-01:
--   expected_orgs = 11
-- Re-run the dry run first. If its totals differ, update CONNECTOR_INPUTS in connector-apply.ts and
-- regenerate; otherwise the apply aborts on the dry-run guard and nothing is written.
-- Send the WHOLE file as ONE request, as a BYPASSRLS role (postgres): the guard aborts otherwise.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL TimeZone = 'UTC';

SELECT set_config('backfill320.expected_orgs', '11', true);

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

  -- Lock the candidate org rows. Of the three tables only companies has an FK to organizations
  -- (companies.organization_id); business_units FKs companies and teams FKs business_units, and
  -- neither has an FK on organization_id. A concurrent INSERT INTO companies for a candidate org takes
  -- FOR KEY SHARE on the organization row, which conflicts with this FOR UPDATE — so it either
  -- committed before the lock (and the NOT EXISTS below, evaluated in a fresh READ COMMITTED snapshot,
  -- sees it) or waits until we commit. Units and teams are serialized TRANSITIVELY: a candidate org
  -- has no company, so a concurrent unit needs a concurrent company first (blocked here), and a
  -- concurrent team needs that unit. A unit/team inserted with a mismatched organization_id (no FK
  -- stops that) is not serialized, but the guard-3 read-back below still checks every target chain.
  PERFORM 1 FROM organizations o
  WHERE o.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM companies x WHERE x.organization_id = o.id)
  ORDER BY o.id
  FOR UPDATE;

  CREATE TEMP TABLE backfill320_targets ON COMMIT DROP AS
  SELECT o.id AS organization_id, o.name AS company_name,
         gen_random_uuid() AS company_id, gen_random_uuid() AS business_unit_id, gen_random_uuid() AS team_id
  FROM organizations o
-- BEGIN TARGET_PREDICATE
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM companies x      WHERE x.organization_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM business_units x WHERE x.organization_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM teams x          WHERE x.organization_id = o.id)
-- END TARGET_PREDICATE
  ;
  GET DIAGNOSTICS v_orgs = ROW_COUNT;

  -- Guard 2: the operator's reviewed dry-run total must still be true.
  IF v_orgs <> v_expect THEN
    RAISE EXCEPTION '#320: % organizations now lack structure, dry run said % — re-run the dry run', v_orgs, v_expect;
  END IF;

  -- The NOT EXISTS re-checks make each insert a no-op on a re-run even if the target step changed.
  INSERT INTO companies (id, organization_id, name, country, created_at, updated_at)
  SELECT tg.company_id, tg.organization_id, tg.company_name, c_country, v_now, v_now
  FROM backfill320_targets tg
  WHERE NOT EXISTS (SELECT 1 FROM companies x WHERE x.organization_id = tg.organization_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_orgs THEN RAISE EXCEPTION '#320: inserted % companies, expected %', v_n, v_orgs; END IF;

  INSERT INTO business_units (id, organization_id, company_id, name, created_at, updated_at)
  SELECT tg.business_unit_id, tg.organization_id, tg.company_id, c_unit, v_now, v_now
  FROM backfill320_targets tg
  WHERE NOT EXISTS (SELECT 1 FROM business_units x WHERE x.organization_id = tg.organization_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_orgs THEN RAISE EXCEPTION '#320: inserted % business units, expected %', v_n, v_orgs; END IF;

  INSERT INTO teams (id, organization_id, business_unit_id, name, created_at, updated_at)
  SELECT tg.team_id, tg.organization_id, tg.business_unit_id, c_team, v_now, v_now
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

  -- Scoped to the TARGET set. An organization that already has a unit or team but no company is
  -- deliberately excluded by TARGET_PREDICATE (partial structure is the owner's to repair), so an
  -- all-organizations assertion here rolled back every valid target because of it (tier-1 review).
  -- Such organizations are reported instead.
  SELECT count(*) INTO v_left
  FROM backfill320_targets tg
  WHERE NOT EXISTS (SELECT 1 FROM companies x WHERE x.organization_id = tg.organization_id);
  IF v_left <> 0 THEN RAISE EXCEPTION '#320: % target organizations still have no company', v_left; END IF;
  SELECT count(*) INTO v_left
  FROM organizations o
  WHERE o.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM companies x WHERE x.organization_id = o.id);
  IF v_left <> 0 THEN
    RAISE NOTICE '#320: % non-deleted organizations with partial structure (a unit or team but no company) were left untouched; repair them by hand', v_left;
  END IF;

  RAISE NOTICE '#320 applied: % organizations provisioned (company + % + %), 0 leaders assigned', v_orgs, c_unit, c_team;
END
$apply$;

COMMIT;

SELECT o.id AS organization_id, o.name AS organization,
       (SELECT count(*) FROM companies x      WHERE x.organization_id = o.id) AS companies,
       (SELECT count(*) FROM business_units x WHERE x.organization_id = o.id) AS business_units,
       (SELECT count(*) FROM teams x          WHERE x.organization_id = o.id) AS teams,
       (SELECT count(*) FROM teams x          WHERE x.organization_id = o.id AND x.leader_id IS NOT NULL) AS teams_with_leader,
       (SELECT count(*) FROM user_business_units x WHERE x.organization_id = o.id) AS unit_assignees
FROM organizations o
WHERE o.deleted_at IS NULL
ORDER BY o.created_at;
