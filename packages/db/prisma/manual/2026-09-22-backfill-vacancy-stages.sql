-- Repair vacancies created before vacancy.create attached starter stages,
-- including closed/frozen vacancies that may later be reopened.
-- Run once with a database owner connection after reviewing the target count.
-- Safe to re-run: vacancies that already have any stage are left untouched.
BEGIN;

SELECT pg_advisory_xact_lock(hashtext('tims:vacancy-stage-backfill')::bigint);

WITH targets AS (
  SELECT v.id, v.organization_id
  FROM vacancies AS v
  WHERE v.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages AS existing WHERE existing.vacancy_id = v.id
    )
  FOR UPDATE
), starter(name, stage_order, sla_hours) AS (
  VALUES
    ('Aplicado', 0, 24),
    ('Screening', 1, 48),
    ('Entrevista RRHH', 2, 72),
    ('Prueba Tecnica', 3, 96),
    ('Entrevista Final', 4, 48),
    ('Oferta', 5, 24),
    ('Contratado', 6, 8)
), inserted AS (
  INSERT INTO pipeline_stages
    (id, organization_id, vacancy_id, name, "order", sla_hours, is_default, created_at, updated_at)
  SELECT gen_random_uuid(), t.organization_id, t.id, s.name, s.stage_order,
         s.sla_hours, s.stage_order = 0, now(), now()
  FROM targets AS t CROSS JOIN starter AS s
  RETURNING vacancy_id
)
SELECT count(DISTINCT vacancy_id) AS repaired_vacancies, count(*) AS inserted_stages
FROM inserted;

COMMIT;
