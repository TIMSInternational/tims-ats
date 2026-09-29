-- Durable per-signal inbox delivery receipts. A notification may be deleted by
-- its recipient; its receipt remains so the 30-second sweep never resends it.
-- Prisma owns this DDL until the assessment-domain ownership flip.

CREATE UNIQUE INDEX IF NOT EXISTS "proctoring_events_id_organization_id_key"
  ON "proctoring_events" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_id_organization_id_key"
  ON "users" ("id", "organization_id");

CREATE TABLE IF NOT EXISTS "proctoring_alert_deliveries" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proctoring_alert_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proctoring_alert_deliveries_event_user_key" UNIQUE ("event_id", "user_id"),
  CONSTRAINT "proctoring_alert_deliveries_notification_key" UNIQUE ("notification_id"),
  CONSTRAINT "proctoring_alert_deliveries_event_tenant_fkey"
    FOREIGN KEY ("event_id", "organization_id")
    REFERENCES "proctoring_events" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "proctoring_alert_deliveries_user_tenant_fkey"
    FOREIGN KEY ("user_id", "organization_id")
    REFERENCES "users" ("id", "organization_id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "proctoring_alert_deliveries_expiry_idx"
  ON "proctoring_alert_deliveries" ("delivered_at", "organization_id");
CREATE INDEX IF NOT EXISTS "proctoring_alert_deliveries_org_event_idx"
  ON "proctoring_alert_deliveries" ("organization_id", "event_id");

REVOKE UPDATE ON "proctoring_alert_deliveries" FROM app_tenant;
GRANT SELECT, INSERT, DELETE ON "proctoring_alert_deliveries" TO app_tenant;
ALTER TABLE "proctoring_alert_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_alert_deliveries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "proctoring_alert_deliveries";
CREATE POLICY tenant_isolation ON "proctoring_alert_deliveries"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- The .NET sweep removes receipts after eight days. Event replay is bounded to
-- seven days, so a removed receipt cannot cause a redelivery. The one-day gap
-- tolerates a delayed sweep. No database extension or scheduled task is needed.
