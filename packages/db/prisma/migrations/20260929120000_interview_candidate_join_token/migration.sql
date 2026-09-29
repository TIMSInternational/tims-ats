-- Candidate video-join capability (WP-H). Only a SHA-256 hash of the join token is stored; the
-- plaintext exists only in the invitation email. Lookup is by exact hash, so the UNIQUE index is
-- the only index needed (it also makes a hash collision fail loudly instead of joining the wrong
-- interview). Nullable: NULL = no candidate join link (in-person, cancelled, or pre-existing rows).
ALTER TABLE "interviews"
  ADD COLUMN IF NOT EXISTS "candidate_join_token_hash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "candidate_join_token_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "interviews_candidate_join_token_hash_key"
  ON "interviews"("candidate_join_token_hash");
