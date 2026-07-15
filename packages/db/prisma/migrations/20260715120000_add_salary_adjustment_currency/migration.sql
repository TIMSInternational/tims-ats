ALTER TABLE "salary_adjustments"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';

UPDATE "salary_adjustments" sa
SET "currency" = ec."currency"
FROM "employee_compensations" ec
WHERE sa."organization_id" = ec."organization_id"
  AND sa."user_id" = ec."user_id"
  AND ec."currency" IS NOT NULL;
