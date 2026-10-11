-- =====================================================================================================
-- #319 — Backfill the default onboarding checklist into existing plans (one-off, idempotent)
-- =====================================================================================================
--
-- WHY. #309 seeds DEFAULT_ONBOARDING_TASKS only on NEW plans (onboarding-plan.repository.ts
-- createWithDefaultsIfNoActive, and the hire handoff in routers/offer/lifecycle.ts convertToEmployee).
-- Active plans created before #309 either have zero tasks (0% progress, ignored by the risk score) or
-- hand-made tasks with no due_date.
--
-- WHAT IT CHANGES (only these two things, nothing else):
--   A. Every ELIGIBLE plan with ZERO tasks gets the 12 default tasks, exactly as
--      defaultOnboardingTasks(plan.start_date, plan.organization_id) builds them:
--        title / responsible           = DEFAULT_ONBOARDING_TASKS[i]
--        "order"                       = i (0-based index, same as the code)
--        due_date                      = start_date + dueOffsetDays days (addUtcDays: the column is a
--                                        UTC wall-clock timestamp WITHOUT time zone, so plain interval
--                                        arithmetic is the same instant)
--        phase                         = onboardingPhaseForOffset(dueOffsetDays):
--                                        <= 30 'day1_30', <= 60 'day31_60', else 'day61_90'
--        organization_id               = the PLAN's organization_id (never anything else)
--        completed false, description / completed_at / completed_by_id NULL (column defaults)
--   B. Every ELIGIBLE plan that already HAS tasks keeps them. Only tasks whose due_date IS NULL get one.
--      Existing due dates are never overwritten. THE RULE for a NULL due_date:
--        1. If the task title is EXACTLY one of the default titles, use that default's offset
--           (start_date + dueOffsetDays) — the same date the code would have given it.
--        2. Otherwise use the END of the task's own phase window:
--           'day1_30' -> start_date + 30, 'day31_60' -> start_date + 60, 'day61_90' -> start_date + 90.
--           The latest date still consistent with the phase, so a backfilled task never turns
--           overdue earlier than its phase allows.
--        3. Any other phase value -> left NULL and listed in the report (needs a human).
--   Check-ins (scheduledOnboardingCheckIns) are NOT backfilled — out of scope for #319; the dry run
--   reports how many eligible plans have none.
--
-- ELIGIBLE PLAN: status = 'active' AND (start_date + 90 days >= now (UTC) OR include_past_day90).
--   #319 leaves "should plans already past day 90 be backfilled?" as an OWNER DECISION. Default here
--   is NO (all 12 tasks would be born overdue and spike the risk score). Pass
--   -v include_past_day90=true to include them. The dry run counts both groups separately.
--
-- HOW TO RUN (psql, as a BYPASSRLS role — the app's `postgres` login; onboarding_* has FORCE RLS, so
-- any other role sees zero rows and the script would be a silent no-op. The apply section refuses to
-- run without BYPASSRLS.)
--
--   1. Dry run (default; writes nothing):
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/db/backfills/319-onboarding-default-tasks.sql
--   2. Apply, passing the TOTALS the dry run printed (the transaction rolls back if they differ):
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -v apply=true \
--             -v expected_empty_plans=<N> -v expected_undated_tasks=<M> \
--             [-v include_past_day90=true] \
--             -f scripts/db/backfills/319-onboarding-default-tasks.sql
--   Re-running after a successful apply is a no-op: the dry run shows 0/0, and an apply with 0/0
--   inserts and updates nothing.
--
-- DRIFT GUARD: tests/db/backfill-defaults-pinned.test.ts parses every block between the
-- BEGIN/END DEFAULT_ONBOARDING_TASKS markers below and asserts it equals the TS constant, and that the
-- phase thresholds equal onboardingPhaseForOffset. Change the constant and that test fails until this
-- file is updated.
-- =====================================================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif
\if :{?include_past_day90}
\else
  \set include_past_day90 false
\endif

\echo '== #319 DRY RUN (read-only) =='

-- DRY-RUN 1: per organization, what would change. Columns:
--   empty_plans_in_window / undated_tasks_in_window        -> changed by a default apply
--   empty_plans_past_day90 / undated_tasks_past_day90      -> changed ONLY with include_past_day90=true
--   undated_tasks_unresolvable                              -> never changed (unknown phase; see report)
--   eligible_plans_without_check_ins                        -> informational only, not backfilled
WITH
-- BEGIN DEFAULT_ONBOARDING_TASKS
defaults(ord, title, responsible, offset_days) AS (VALUES
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
),
-- END DEFAULT_ONBOARDING_TASKS
plans AS (
  SELECT p.id, p.organization_id, p.start_date,
         (p.start_date + interval '90 days' < (now() AT TIME ZONE 'UTC')) AS past_day90,
         NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = p.id) AS is_empty,
         NOT EXISTS (SELECT 1 FROM onboarding_check_ins c WHERE c.plan_id = p.id) AS no_check_ins
  FROM onboarding_plans p
  WHERE p.status = 'active'
),
undated AS (
  SELECT pl.organization_id, pl.past_day90,
         COALESCE(d.offset_days,
                  CASE t.phase WHEN 'day1_30' THEN 30 WHEN 'day31_60' THEN 60 WHEN 'day61_90' THEN 90 END)
           AS offset_days
  FROM plans pl
  JOIN onboarding_tasks t ON t.plan_id = pl.id AND t.due_date IS NULL
  LEFT JOIN defaults d ON d.title = t.title
)
SELECT o.id AS organization_id, o.name AS organization,
       (SELECT count(*) FROM plans pl WHERE pl.organization_id = o.id)                                         AS active_plans,
       (SELECT count(*) FROM plans pl WHERE pl.organization_id = o.id AND pl.is_empty AND NOT pl.past_day90)   AS empty_plans_in_window,
       (SELECT count(*) FROM plans pl WHERE pl.organization_id = o.id AND pl.is_empty AND pl.past_day90)       AS empty_plans_past_day90,
       (SELECT count(*) FROM plans pl WHERE pl.organization_id = o.id AND pl.is_empty AND NOT pl.past_day90)
         * (SELECT count(*) FROM defaults)                                                                      AS tasks_to_insert_in_window,
       (SELECT count(*) FROM undated u WHERE u.organization_id = o.id AND u.offset_days IS NOT NULL AND NOT u.past_day90) AS undated_tasks_in_window,
       (SELECT count(*) FROM undated u WHERE u.organization_id = o.id AND u.offset_days IS NOT NULL AND u.past_day90)     AS undated_tasks_past_day90,
       (SELECT count(*) FROM undated u WHERE u.organization_id = o.id AND u.offset_days IS NULL)                          AS undated_tasks_unresolvable,
       (SELECT count(*) FROM plans pl WHERE pl.organization_id = o.id AND pl.no_check_ins AND NOT pl.past_day90)          AS eligible_plans_without_check_ins
FROM organizations o
ORDER BY o.created_at;

-- DRY-RUN 2: totals to pass as -v expected_empty_plans / -v expected_undated_tasks.
--   *_default    -> use for an apply WITHOUT include_past_day90
--   *_with_past  -> use for an apply WITH include_past_day90=true
WITH
-- BEGIN DEFAULT_ONBOARDING_TASKS
defaults(ord, title, responsible, offset_days) AS (VALUES
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
),
-- END DEFAULT_ONBOARDING_TASKS
plans AS (
  SELECT p.id, (p.start_date + interval '90 days' < (now() AT TIME ZONE 'UTC')) AS past_day90,
         NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = p.id) AS is_empty
  FROM onboarding_plans p WHERE p.status = 'active'
),
undated AS (
  SELECT pl.past_day90
  FROM plans pl
  JOIN onboarding_tasks t ON t.plan_id = pl.id AND t.due_date IS NULL
  LEFT JOIN defaults d ON d.title = t.title
  WHERE COALESCE(d.offset_days,
                 CASE t.phase WHEN 'day1_30' THEN 30 WHEN 'day31_60' THEN 60 WHEN 'day61_90' THEN 90 END) IS NOT NULL
)
SELECT (SELECT count(*) FROM plans WHERE is_empty AND NOT past_day90) AS expected_empty_plans_default,
       (SELECT count(*) FROM undated WHERE NOT past_day90)            AS expected_undated_tasks_default,
       (SELECT count(*) FROM plans WHERE is_empty)                    AS expected_empty_plans_with_past,
       (SELECT count(*) FROM undated)                                 AS expected_undated_tasks_with_past;

-- DRY-RUN 3 (report — needs a human): undated tasks whose phase is not one of the three known values.
SELECT p.organization_id, t.plan_id, t.id AS task_id, t.title, t.phase
FROM onboarding_tasks t
JOIN onboarding_plans p ON p.id = t.plan_id AND p.status = 'active'
WHERE t.due_date IS NULL
  AND t.phase NOT IN ('day1_30', 'day31_60', 'day61_90')
  AND t.title NOT IN (
-- BEGIN DEFAULT_ONBOARDING_TITLES
    'Firmar contrato y documentos de ingreso',
    'Preparar equipo y accesos de TI (laptop, correo, sistemas)',
    'Bienvenida del primer día y recorrido por la empresa',
    'Presentación con el buddy asignado',
    'Leer y aceptar las políticas de la empresa',
    'Reunión 1:1 de bienvenida con el manager',
    'Inscripción en nómina y beneficios',
    'Presentación con el equipo',
    'Definir objetivos de 30/60/90 días',
    'Revisión de objetivos de 30 días',
    'Revisión de objetivos de 60 días',
    'Revisión de objetivos de 90 días y cierre del onboarding'
-- END DEFAULT_ONBOARDING_TITLES
  )
ORDER BY p.organization_id, t.plan_id, t."order";

\if :apply
\echo '== #319 APPLY (single transaction; any failed assertion rolls everything back) =='
\if :{?expected_empty_plans}
\else
  DO $abort$ BEGIN RAISE EXCEPTION '#319: -v expected_empty_plans=<N> is required with apply=true (copy it from DRY-RUN 2)'; END $abort$;
\endif
\if :{?expected_undated_tasks}
\else
  DO $abort$ BEGIN RAISE EXCEPTION '#319: -v expected_undated_tasks=<M> is required with apply=true (copy it from DRY-RUN 2)'; END $abort$;
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';

\o /dev/null
SELECT set_config('backfill319.include_past_day90', :'include_past_day90', true),
       set_config('backfill319.expected_empty_plans', :'expected_empty_plans', true),
       set_config('backfill319.expected_undated_tasks', :'expected_undated_tasks', true);
\o

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

  -- Lock every active plan: a concurrent task insert (FK KEY SHARE on the plan) or a plan update now
  -- waits for this transaction, so the target sets computed below cannot go stale before the writes.
  PERFORM 1 FROM onboarding_plans WHERE status = 'active' ORDER BY id FOR UPDATE;

  CREATE TEMP TABLE backfill319_empty_plans ON COMMIT DROP AS
  SELECT p.id, p.organization_id, p.start_date
  FROM onboarding_plans p
  WHERE p.status = 'active'
    AND (v_include_past OR p.start_date + interval '90 days' >= v_now)
    AND NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = p.id);
  GET DIAGNOSTICS v_plans = ROW_COUNT;

  CREATE TEMP TABLE backfill319_undated ON COMMIT DROP AS
  SELECT t.id AS task_id,
         p.start_date + make_interval(days => COALESCE(d.offset_days,
           CASE t.phase WHEN 'day1_30' THEN 30 WHEN 'day31_60' THEN 60 WHEN 'day61_90' THEN 90 END)) AS new_due_date
  FROM onboarding_tasks t
  JOIN onboarding_plans p ON p.id = t.plan_id
  LEFT JOIN backfill319_defaults d ON d.title = t.title
  WHERE p.status = 'active'
    AND (v_include_past OR p.start_date + interval '90 days' >= v_now)
    AND t.due_date IS NULL
    AND COALESCE(d.offset_days,
          CASE t.phase WHEN 'day1_30' THEN 30 WHEN 'day31_60' THEN 60 WHEN 'day61_90' THEN 90 END) IS NOT NULL;
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
  WHERE t.id = u.task_id AND t.due_date IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_undated THEN
    RAISE EXCEPTION '#319: dated % tasks, expected %', v_updated, v_undated;
  END IF;

  -- Guard 3: post-condition — no eligible active plan is left empty.
  SELECT count(*) INTO v_left
  FROM onboarding_plans p
  WHERE p.status = 'active'
    AND (v_include_past OR p.start_date + interval '90 days' >= v_now)
    AND NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.plan_id = p.id);
  IF v_left <> 0 THEN
    RAISE EXCEPTION '#319: % eligible plans still have zero tasks after insert', v_left;
  END IF;

  RAISE NOTICE '#319 applied: % plans x % tasks = % inserted; % undated tasks dated (include_past_day90=%)',
    v_plans, v_defaults, v_inserted, v_updated, v_include_past;
END
$apply$;

COMMIT;

\echo '== #319 READ-BACK (after commit) =='
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
\else
\echo '== DRY RUN ONLY — nothing was written. Re-run with -v apply=true and the expected_* totals to apply. =='
\endif
