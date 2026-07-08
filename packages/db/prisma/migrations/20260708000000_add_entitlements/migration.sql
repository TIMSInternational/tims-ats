-- CreateTable
CREATE TABLE "modules" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "metered" BOOLEAN NOT NULL DEFAULT false,
    "unit" TEXT,
    "default_unit_price" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "plans" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "plan_modules" (
    "id" UUID NOT NULL,
    "plan_code" TEXT NOT NULL,
    "module_code" TEXT NOT NULL,
    "limit" INTEGER,

    CONSTRAINT "plan_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_entitlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "module_code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "limit" INTEGER,
    "unit_price" DOUBLE PRECISION,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_modules_plan_code_module_code_key" ON "plan_modules"("plan_code", "module_code");

-- CreateIndex
CREATE INDEX "org_entitlements_organization_id_idx" ON "org_entitlements"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_entitlements_organization_id_module_code_key" ON "org_entitlements"("organization_id", "module_code");

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "modules"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_entitlements" ADD CONSTRAINT "org_entitlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_entitlements" ADD CONSTRAINT "org_entitlements_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "modules"("code") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation for org_entitlements (modules/plans/plan_modules are global catalogs, RLS-exempt)
ALTER TABLE "org_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_entitlements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "org_entitlements";
CREATE POLICY tenant_isolation ON "org_entitlements" USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
