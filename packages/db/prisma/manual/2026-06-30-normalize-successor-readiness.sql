-- Normalize legacy successor readiness values to canonical format.
-- Run in prod via: prisma db execute --file packages/db/prisma/manual/2026-06-30-normalize-successor-readiness.sql
-- Table: successors  Column: readiness (plain String, no @map)
-- Idempotent: rows already in canonical format are unaffected.

UPDATE "successors" SET "readiness" = 'ready_1_year'  WHERE "readiness" = 'ready_in_1_year';
UPDATE "successors" SET "readiness" = 'ready_2_years' WHERE "readiness" = 'ready_in_2_years';
