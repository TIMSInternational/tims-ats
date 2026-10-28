-- candidate-email-collision-report.sql  (#315)
--
-- READ-ONLY. Returns COUNTS ONLY, grouped by organization id: no email addresses, no names,
-- no candidate ids. For the owner to run before any backfill of candidates.email to its
-- canonical form, lower(btrim(email)).
--
-- Why: `candidates` has UNIQUE (organization_id, email), which is case-SENSITIVE. Rows of one
-- org that differ only by case or surrounding whitespace are legal today, but they are the same
-- person, and a backfill that lowercases them would violate the unique constraint. Merging them
-- is a human decision. Never auto-merge.
--
-- Run (read-only transaction, so nothing can be written even by mistake):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ops/candidate-email-collision-report.sql
--
-- Columns:
--   organization_id               the org (uuid only, no name)
--   total_candidates              all rows of the org, soft-deleted included
--   non_canonical_rows            rows whose stored email is not already lower(btrim(email))
--   blank_email_rows              rows whose email is empty after trimming
--   collision_groups              canonical emails held by more than one row (soft-deleted
--                                 included, because the unique constraint covers them too).
--                                 Each one blocks a plain lowercase backfill.
--   rows_in_collision_groups      total rows inside those groups
--   active_collision_groups       canonical emails held by more than one ACTIVE, non-deleted row.
--                                 These are the candidates whose careers-portal view is split:
--                                 the portal shows one row deterministically, so applications
--                                 attached to the other row are not visible to the candidate.
-- Only orgs with at least one non-canonical, blank or colliding row are listed. The last row,
-- with organization_id NULL, is the total across all orgs.

BEGIN TRANSACTION READ ONLY;

WITH canon AS (
  SELECT
    organization_id,
    lower(btrim(email))                         AS canonical_email,
    (email <> lower(btrim(email)))              AS is_non_canonical,
    (btrim(email) = '')                         AS is_blank,
    (is_active AND deleted_at IS NULL)          AS is_live
  FROM candidates
),
groups AS (
  SELECT
    organization_id,
    canonical_email,
    count(*)                                    AS n_rows,
    count(*) FILTER (WHERE is_live)             AS n_live
  FROM canon
  WHERE NOT is_blank
  GROUP BY organization_id, canonical_email
),
per_org AS (
  SELECT
    c.organization_id,
    count(*)                                    AS total_candidates,
    count(*) FILTER (WHERE c.is_non_canonical)  AS non_canonical_rows,
    count(*) FILTER (WHERE c.is_blank)          AS blank_email_rows
  FROM canon c
  GROUP BY c.organization_id
),
per_org_groups AS (
  SELECT
    organization_id,
    count(*) FILTER (WHERE n_rows > 1)                       AS collision_groups,
    coalesce(sum(n_rows) FILTER (WHERE n_rows > 1), 0)       AS rows_in_collision_groups,
    count(*) FILTER (WHERE n_live > 1)                       AS active_collision_groups
  FROM groups
  GROUP BY organization_id
),
report AS (
  SELECT
    o.organization_id,
    o.total_candidates,
    o.non_canonical_rows,
    o.blank_email_rows,
    coalesce(g.collision_groups, 0)          AS collision_groups,
    coalesce(g.rows_in_collision_groups, 0)  AS rows_in_collision_groups,
    coalesce(g.active_collision_groups, 0)   AS active_collision_groups
  FROM per_org o
  LEFT JOIN per_org_groups g USING (organization_id)
  WHERE o.non_canonical_rows > 0
     OR o.blank_email_rows > 0
     OR coalesce(g.collision_groups, 0) > 0
)
SELECT * FROM (
  SELECT
    organization_id,
    total_candidates,
    non_canonical_rows,
    blank_email_rows,
    collision_groups,
    rows_in_collision_groups,
    active_collision_groups,
    0 AS sort_key
  FROM report
  UNION ALL
  SELECT
    NULL::uuid,
    coalesce(sum(total_candidates), 0),
    coalesce(sum(non_canonical_rows), 0),
    coalesce(sum(blank_email_rows), 0),
    coalesce(sum(collision_groups), 0),
    coalesce(sum(rows_in_collision_groups), 0),
    coalesce(sum(active_collision_groups), 0),
    1
  FROM report
) r
ORDER BY sort_key, collision_groups DESC, non_canonical_rows DESC, organization_id;

ROLLBACK;
