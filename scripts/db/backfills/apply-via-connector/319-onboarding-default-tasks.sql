-- GENERATED FILE - do not edit. Source: scripts/db/backfills/319-onboarding-default-tasks.sql (its CONNECTOR-APPLY section).
-- Regenerate: npx tsx scripts/db/backfills/generate-connector-applies.ts
--
-- Pure SQL for a connector that cannot run psql meta-commands: the same single transaction, guards
-- and assertions as the psql apply, with its psql variables inlined from the production dry run of
-- 2026-10-01:
--   include_past_day90 = false
--   expected_empty_plans = 0
--   expected_undated_tasks = 0
-- Re-run the dry run first. If its totals differ, update CONNECTOR_INPUTS in connector-apply.ts and
-- regenerate; otherwise the apply aborts on the dry-run guard and nothing is written.
-- Send the WHOLE file as ONE request, as a BYPASSRLS role (postgres): the guard aborts otherwise.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL TimeZone = 'UTC';

SELECT set_config('backfill319.include_past_day90', 'false', true),
       set_config('backfill319.expected_empty_plans', '0', true),
       set_config('backfill319.expected_undated_tasks', '0', true);

CREATE TEMP TABLE backfill319_defaults ON COMMIT DROP AS
SELECT * FROM (
-- BEGIN DEFAULT_ONBOARDING_TASKS
VALUES
  (0,  'Firmar contrato y documentos de ingreso',                    'hr',       -3),
  (1,  'Preparar equipo y accesos de TI (laptop, correo, sistemas)', 'it',       -1),
  (2,  'Bienvenida del primer día y recorrido por la empresa',       'hr',        0),
  (3,  'Presentación con el buddy asignado',                         'buddy',     0),
  (4,  'Leer y aceptar las políticas de la empresa',                 'employee',  2),
  (5,  'Reunión 1:1 de bienvenida con el manager',                   'manager',   2),
  (6,  'Inscripción en nómina y beneficios',                         'employee',  5),
  (7,  'Presentación con el equipo',                                 'manager',   5),
  (8,  'Definir objetivos de 30/60/90 días',                         'manager',   7),
  (9,  'Revisión de objetivos de 30 días',                           'manager',  30),
  (10, 'Revisión de objetivos de 60 días',                           'manager',  60),
  (11, 'Revisión de objetivos de 90 días y cierre del onboarding',   'hr',       90)
-- END DEFAULT_ONBOARDING_TASKS
) AS d(ord, title, responsible, offset_days);

DO $apply$
DECLARE
  v_include_past  boolean := current_setting('backfill319.include_past_day90')::boolean;
  v_expect_plans  integer := current_setting('backfill319.expected_empty_plans')::integer;
  v_expect_tasks  integer := current_setting('backfill319.expected_undated_tasks')::integer;
  v_now           timestamp := now() AT TIME ZONE 'UTC';
  v_defaults      integer;
  v_plans         integer;
  v_undated       integer;
  v_inserted      integer;
  v_updated       integer;
  v_left          integer;
BEGIN
  -- Guard 1: onboarding_* tables are FORCE RLS; without BYPASSRLS every count below is 0 and the
  -- backfill would "succeed" while doing nothing.
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '#319: role % lacks BYPASSRLS; run as the app owner login (postgres)', current_user;
  END IF;

  SELECT count(*) INTO v_defaults FROM backfill319_defaults;
  IF v_defaults <> 12 THEN
    RAISE EXCEPTION '#319: expected 12 default tasks, found %', v_defaults;
  END IF;

  -- Lock every active plan: a concurrent task insert (onboarding_tasks.plan_id FK -> FOR KEY SHARE on
  -- the plan row) or a plan update now waits for this transaction, so the target sets computed below
  -- cannot go stale before the writes.
  PERFORM 1 FROM onboarding_plans WHERE status = 'active' ORDER BY id FOR UPDATE;

  CREATE TEMP TABLE backfill319_empty_plans ON COMMIT DROP AS
  SELECT p.id, p.organization_id, p.start_date
  FROM onboarding_plans p
  WHERE p.status = 'active'
-- BEGIN PLAN_IN_WINDOW
    AND (v_include_past OR p.start_date + interval '90 days' >= v_now)
-- END PLAN_IN_WINDOW
    AND NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = p.id);
  GET DIAGNOSTICS v_plans = ROW_COUNT;

  -- Lock the undated tasks of those plans too. Plan locks do not stop updateTask from editing an
  -- EXISTING task's phase or title, and the due date below is computed from both; without this, an
  -- edit committed between this snapshot and the UPDATE got a deadline from the old phase (tier-1
  -- review). The UPDATE also re-checks phase and title, so a change can never be written silently.
  PERFORM 1
  FROM onboarding_tasks t
  JOIN onboarding_plans p ON p.id = t.plan_id
  WHERE p.status = 'active'
-- BEGIN PLAN_IN_WINDOW
    AND (v_include_past OR p.start_date + interval '90 days' >= v_now)
-- END PLAN_IN_WINDOW
    AND t.due_date IS NULL
  ORDER BY t.id
  FOR UPDATE OF t;

  CREATE TEMP TABLE backfill319_undated ON COMMIT DROP AS
  SELECT task_id, task_phase, task_title, start_date + make_interval(days => offset_days) AS new_due_date
  FROM (
    SELECT t.id AS task_id, t.phase AS task_phase, t.title AS task_title, p.start_date,
-- BEGIN DUE_OFFSET_RULE
         CASE
           WHEN t.phase IN ('day1_30', 'day31_60', 'day61_90') THEN
             CASE
               WHEN d.offset_days IS NOT NULL
                AND (CASE WHEN d.offset_days <= 30 THEN 'day1_30' WHEN d.offset_days <= 60 THEN 'day31_60' ELSE 'day61_90' END) = t.phase
                 THEN d.offset_days
               ELSE CASE t.phase WHEN 'day1_30' THEN 30 WHEN 'day31_60' THEN 60 WHEN 'day61_90' THEN 90 END
             END
           ELSE d.offset_days
         END
-- END DUE_OFFSET_RULE
           AS offset_days
    FROM onboarding_tasks t
    JOIN onboarding_plans p ON p.id = t.plan_id
    LEFT JOIN backfill319_defaults d ON d.title = t.title
    WHERE p.status = 'active'
-- BEGIN PLAN_IN_WINDOW
    AND (v_include_past OR p.start_date + interval '90 days' >= v_now)
-- END PLAN_IN_WINDOW
      AND t.due_date IS NULL
  ) resolved
  WHERE offset_days IS NOT NULL;
  GET DIAGNOSTICS v_undated = ROW_COUNT;

  -- Guard 2: the operator's reviewed dry-run totals must still be true.
  IF v_plans <> v_expect_plans THEN
    RAISE EXCEPTION '#319: % empty plans now eligible, dry run said % — re-run the dry run', v_plans, v_expect_plans;
  END IF;
  IF v_undated <> v_expect_tasks THEN
    RAISE EXCEPTION '#319: % undated tasks now fillable, dry run said % — re-run the dry run', v_undated, v_expect_tasks;
  END IF;

  -- A. Default checklist into empty plans. The NOT EXISTS re-check makes a re-run a no-op even if
  -- the temp-table step were ever removed.
  INSERT INTO onboarding_tasks
    (id, organization_id, plan_id, title, responsible, phase, due_date, completed, "order", created_at, updated_at)
  SELECT gen_random_uuid(), ep.organization_id, ep.id, d.title, d.responsible,
         CASE WHEN d.offset_days <= 30 THEN 'day1_30' WHEN d.offset_days <= 60 THEN 'day31_60' ELSE 'day61_90' END,
         ep.start_date + make_interval(days => d.offset_days),
         false, d.ord, v_now, v_now
  FROM backfill319_empty_plans ep
  CROSS JOIN backfill319_defaults d
  WHERE NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = ep.id);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_plans * v_defaults THEN
    RAISE EXCEPTION '#319: inserted % tasks, expected % (% plans x %)', v_inserted, v_plans * v_defaults, v_plans, v_defaults;
  END IF;

  -- B. Dates for undated tasks only. `due_date IS NULL` in the WHERE means an existing date is never
  -- overwritten and a re-run updates nothing.
  UPDATE onboarding_tasks t
  SET due_date = u.new_due_date, updated_at = v_now
  FROM backfill319_undated u
  WHERE t.id = u.task_id AND t.due_date IS NULL
    AND t.phase IS NOT DISTINCT FROM u.task_phase AND t.title IS NOT DISTINCT FROM u.task_title;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_undated THEN
    RAISE EXCEPTION '#319: dated % tasks, expected %', v_updated, v_undated;
  END IF;

  -- Guard 3: post-condition — no eligible active plan is left empty.
  SELECT count(*) INTO v_left
  FROM onboarding_plans p
  WHERE p.status = 'active'
-- BEGIN PLAN_IN_WINDOW
    AND (v_include_past OR p.start_date + interval '90 days' >= v_now)
-- END PLAN_IN_WINDOW
    AND NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = p.id);
  IF v_left <> 0 THEN
    RAISE EXCEPTION '#319: % eligible plans still have zero tasks after insert', v_left;
  END IF;

  RAISE NOTICE '#319 applied: % plans x % tasks = % inserted; % undated tasks dated (include_past_day90=%)',
    v_plans, v_defaults, v_inserted, v_updated, v_include_past;
END
$apply$;

COMMIT;

SELECT o.id AS organization_id, o.name AS organization,
       count(DISTINCT p.id) FILTER (WHERE p.status = 'active')                                      AS active_plans,
       count(DISTINCT p.id) FILTER (WHERE p.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = p.id))                   AS active_plans_still_empty,
       count(t.id) FILTER (WHERE p.status = 'active' AND t.due_date IS NULL)                         AS active_undated_tasks_left,
       count(t.id) FILTER (WHERE p.status = 'active' AND t.updated_at >= now() AT TIME ZONE 'UTC' - interval '10 minutes')
                                                                                                     AS tasks_touched_last_10_min
FROM organizations o
LEFT JOIN onboarding_plans p ON p.organization_id = o.id
LEFT JOIN onboarding_tasks t ON t.plan_id = p.id
GROUP BY o.id, o.name, o.created_at
ORDER BY o.created_at;
