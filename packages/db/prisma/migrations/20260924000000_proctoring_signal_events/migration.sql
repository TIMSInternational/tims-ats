-- Proctoring signals are append-only review cues. No photos, audio, video or
-- screenshots are stored here. Existing session JSON is retained read-only for
-- historical compatibility; new signals are normalized and idempotent.

-- Snapshot the assessment-type policy at assignment time. Existing assignments
-- remain unproctored; changing a type never changes an exam already assigned.
ALTER TABLE "assessment_assignments"
  ADD COLUMN IF NOT EXISTS "proctoring_required" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "proctoring_sessions"
  ADD COLUMN IF NOT EXISTS "consented_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "consent_version" TEXT,
  ADD COLUMN IF NOT EXISTS "last_heartbeat_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_status" TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS "review_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_by_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "proctoring_sessions_id_organization_id_key"
  ON "proctoring_sessions" ("id", "organization_id");

CREATE TABLE IF NOT EXISTS "proctoring_events" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "client_event_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "client_at" TIMESTAMP(3),
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proctoring_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proctoring_events_session_tenant_fkey" FOREIGN KEY ("session_id", "organization_id")
    REFERENCES "proctoring_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proctoring_events_source_check" CHECK ("source" IN ('client_observation', 'server_inferred')),
  CONSTRAINT "proctoring_events_severity_check" CHECK ("severity" IN ('low', 'medium')),
  CONSTRAINT "proctoring_events_type_check" CHECK ("type" IN (
    'tab_hidden', 'focus_lost', 'camera_stopped', 'screen_share_stopped',
    'face_missing', 'multiple_faces', 'model_unavailable', 'heartbeat_gap'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS "proctoring_events_session_id_client_event_id_key"
  ON "proctoring_events" ("session_id", "client_event_id");
CREATE INDEX IF NOT EXISTS "proctoring_events_organization_id_session_id_occurred_at_idx"
  ON "proctoring_events" ("organization_id", "session_id", "occurred_at");

-- The tenant role may append/read but may not edit or erase observations.
REVOKE UPDATE, DELETE ON "proctoring_events" FROM app_tenant;
GRANT SELECT, INSERT ON "proctoring_events" TO app_tenant;
ALTER TABLE "proctoring_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "proctoring_events";
CREATE POLICY tenant_isolation ON "proctoring_events"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
