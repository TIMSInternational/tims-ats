-- Sprint 1.3 Task 1: per-application checklist-completion tracking, keyed by
-- stage: Record<stageId, Record<itemKey, { completed, completedBy, completedAt }>>.
-- Powers the soft (warn-but-allow) gate on pipeline.moveCandidate — a stage
-- move never fails because of this column, it only surfaces which of the
-- SOURCE stage's checklist items are still incomplete. Additive nullable
-- column, no backfill/data-migration needed.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "checklist_progress" JSONB;
