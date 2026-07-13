-- Sprint 1.5 Task 1: FIT Engine schema foundation
-- Adds RoleFamilyWeightProfile model, Vacancy.roleFamily field, and Candidate education/languages fields

-- Add roleFamily column to vacancies table
ALTER TABLE "vacancies" ADD COLUMN "role_family" TEXT;

-- Create role_family_weight_profiles table
CREATE TABLE "role_family_weight_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_family_weight_profiles_pkey" PRIMARY KEY ("id")
);

-- Add indexes to role_family_weight_profiles
CREATE INDEX "role_family_weight_profiles_organization_id_idx" ON "role_family_weight_profiles"("organization_id");

-- Add unique constraint to role_family_weight_profiles
CREATE UNIQUE INDEX "role_family_weight_profiles_organization_id_name_key" ON "role_family_weight_profiles"("organization_id", "name");

-- Add foreign key constraint
ALTER TABLE "role_family_weight_profiles" ADD CONSTRAINT "role_family_weight_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

-- Add education and languages columns to candidates table
ALTER TABLE "candidates" ADD COLUMN "education" JSONB;
ALTER TABLE "candidates" ADD COLUMN "languages" JSONB;
