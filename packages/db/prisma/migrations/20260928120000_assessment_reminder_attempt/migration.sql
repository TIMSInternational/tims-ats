-- A per-assignment claim prevents concurrent reminder requests from sending
-- duplicate emails. Keep reminder_sent_at reserved for provider acceptance.
ALTER TABLE "assessment_assignments"
  ADD COLUMN IF NOT EXISTS "reminder_attempted_at" TIMESTAMP(3);
