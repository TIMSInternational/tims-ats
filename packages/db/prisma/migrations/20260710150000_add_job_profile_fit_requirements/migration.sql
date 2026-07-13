-- Sprint 1.5 Codex-review fix (Finding 1): dedicated structured requirements
-- field for the FIT Engine, separate from JobProfile.requirements (the
-- existing free-text HR checklist array). Additive only.

-- Add fit_requirements column to job_profiles table
ALTER TABLE "job_profiles" ADD COLUMN "fit_requirements" JSONB;
