CREATE UNIQUE INDEX IF NOT EXISTS "invoices_org_period_draft_key"
  ON "invoices" ("organization_id", "period_start", "period_end")
  WHERE status = 'draft' AND period_start IS NOT NULL AND period_end IS NOT NULL;
