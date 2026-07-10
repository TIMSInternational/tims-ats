-- Sprint 1.2 Task 2: per-user dismiss timestamp for the first-login
-- "Setup Checklist" widget (organization.getSetupStatus /
-- organization.dismissSetupChecklist). Additive nullable column, no
-- backfill/data-migration needed.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "setup_checklist_dismissed_at" TIMESTAMP(3);
