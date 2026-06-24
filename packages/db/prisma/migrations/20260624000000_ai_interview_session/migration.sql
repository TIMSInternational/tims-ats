-- AI Voice Interview — database foundation.
-- Adds AiInterviewStatus + AiAnalysisStatus enums and the ai_interview_sessions
-- table. One session per interview (1:1, UNIQUE on interview_id). Tenant-scoped
-- via organization_id + @@index. Prod is NOT prisma-migrate-managed; apply via:
--   npx prisma db execute --file=packages/db/prisma/migrations/20260624000000_ai_interview_session/migration.sql
-- RLS policy must be added post-deploy (matches pattern from 20260604100000).

-- 1) Enums.
DO $$ BEGIN
  CREATE TYPE "AiInterviewStatus" AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'failed',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AiAnalysisStatus" AS ENUM (
    'pending',
    'completed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Table.
CREATE TABLE IF NOT EXISTS "ai_interview_sessions" (
  "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"             UUID         NOT NULL,
  "interview_id"                UUID         NOT NULL,
  "candidate_id"                UUID         NOT NULL,
  "vacancy_id"                  UUID         NOT NULL,
  "status"                      "AiInterviewStatus" NOT NULL DEFAULT 'pending',
  "elevenlabs_agent_id"         TEXT,
  "elevenlabs_conversation_id"  TEXT,
  "guide_questions"             JSONB        NOT NULL,
  "transcript"                  JSONB,
  "audio_url"                   TEXT,
  "duration_seconds"            INTEGER,
  "consented_at"                TIMESTAMP(3),
  "consent_text_version"        TEXT,
  "analysis_status"             "AiAnalysisStatus" NOT NULL DEFAULT 'pending',
  "summary"                     JSONB,
  "bias_report"                 JSONB,
  "fit_score"                   INTEGER,
  "analysis_model"              TEXT,
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_interview_sessions_pkey" PRIMARY KEY ("id")
);

-- 3) candidateToken column (added in review fix — separate random token for magic-link).
--    gen_random_uuid() requires pgcrypto (available on Supabase/pg14+).
--    DEFAULT ensures existing rows get a value; idempotent via IF NOT EXISTS guard.
DO $$ BEGIN
  ALTER TABLE "ai_interview_sessions"
    ADD COLUMN "candidate_token" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 3a) Unique constraints.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_interview_sessions_interview_id_key"
  ON "ai_interview_sessions" ("interview_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_interview_sessions_elevenlabs_conversation_id_key"
  ON "ai_interview_sessions" ("elevenlabs_conversation_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_interview_sessions_candidate_token_key"
  ON "ai_interview_sessions" ("candidate_token");

-- 4) Tenant + FK indexes (Prisma does NOT auto-create these).
CREATE INDEX IF NOT EXISTS "ai_interview_sessions_organization_id_idx"
  ON "ai_interview_sessions" ("organization_id");

CREATE INDEX IF NOT EXISTS "ai_interview_sessions_candidate_id_idx"
  ON "ai_interview_sessions" ("candidate_id");

CREATE INDEX IF NOT EXISTS "ai_interview_sessions_vacancy_id_idx"
  ON "ai_interview_sessions" ("vacancy_id");

-- 5) Foreign keys.
ALTER TABLE "ai_interview_sessions"
  ADD CONSTRAINT "ai_interview_sessions_interview_id_fkey"
    FOREIGN KEY ("interview_id") REFERENCES "interviews" ("id") ON DELETE CASCADE;

ALTER TABLE "ai_interview_sessions"
  ADD CONSTRAINT "ai_interview_sessions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;

-- 6) RLS — enable (fail-closed; add tenant policy in same deploy step).
ALTER TABLE "ai_interview_sessions" ENABLE ROW LEVEL SECURITY;
