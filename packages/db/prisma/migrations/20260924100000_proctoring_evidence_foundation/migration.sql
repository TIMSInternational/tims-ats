-- First-company beta evidence metadata. Media bytes stay in private S3. This
-- Prisma-owned migration is additive and does not activate evidence capture.

-- The candidate can explicitly stop storing media while browser-only signals
-- continue. Preserve the original event allowlist and add that one signal.
ALTER TABLE "proctoring_events"
  DROP CONSTRAINT "proctoring_events_type_check";
ALTER TABLE "proctoring_events"
  ADD CONSTRAINT "proctoring_events_type_check" CHECK ("type" IN (
    'tab_hidden', 'focus_lost', 'camera_stopped', 'screen_share_stopped',
    'face_missing', 'multiple_faces', 'model_unavailable', 'heartbeat_gap',
    'media_capture_stopped'
  ));

-- Composite tenant FKs prevent evidence for one organization from being
-- attached to another organization's assignment or proctoring session.
ALTER TABLE "proctoring_sessions"
  ADD COLUMN "media_consented_at" TIMESTAMP(3),
  ADD COLUMN "media_consent_version" VARCHAR(128),
  ADD COLUMN "media_stopped_at" TIMESTAMP(3);
ALTER TABLE "proctoring_sessions"
  ADD CONSTRAINT "proctoring_sessions_media_consent_pair_check"
  CHECK (("media_consented_at" IS NULL AND "media_consent_version" IS NULL) OR
         ("media_consented_at" IS NOT NULL AND
         NULLIF("media_consent_version", '') IS NOT NULL));

-- Stopping stored-media capture is a one-way privacy choice for the session.
-- The candidate can still complete the browser-only proctoring assessment.
CREATE FUNCTION proctoring_media_stop_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.media_stopped_at IS NOT NULL AND
     NEW.media_stopped_at IS DISTINCT FROM OLD.media_stopped_at THEN
    RAISE EXCEPTION 'proctoring media stop is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER proctoring_media_stop_guard_update
BEFORE UPDATE ON "proctoring_sessions"
FOR EACH ROW EXECUTE FUNCTION proctoring_media_stop_guard_update();

CREATE UNIQUE INDEX "assessment_assignments_id_organization_id_key"
  ON "assessment_assignments" ("id", "organization_id");
CREATE UNIQUE INDEX "proctoring_sessions_id_organization_id_assignment_id_key"
  ON "proctoring_sessions" ("id", "organization_id", "assignment_id");

CREATE TABLE "proctoring_evidence" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "client_capture_id" UUID NOT NULL,
  "media_type" VARCHAR(16) NOT NULL,
  "capture_reason" VARCHAR(16) NOT NULL,
  "capture_slot" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'intent',
  "staging_object_key" VARCHAR(512) NOT NULL,
  "sealed_object_key" VARCHAR(512),
  "content_type" VARCHAR(32) NOT NULL,
  "max_bytes" INTEGER NOT NULL,
  "byte_size" INTEGER,
  "sha256" VARCHAR(64),
  "staging_etag" VARCHAR(128),
  "sealed_etag" VARCHAR(128),
  "model_revision" VARCHAR(128),
  "intent_expires_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "failure_code" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proctoring_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proctoring_evidence_assignment_tenant_fkey"
    FOREIGN KEY ("assignment_id", "organization_id")
    REFERENCES "assessment_assignments" ("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proctoring_evidence_session_assignment_tenant_fkey"
    FOREIGN KEY ("session_id", "organization_id", "assignment_id")
    REFERENCES "proctoring_sessions" ("id", "organization_id", "assignment_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proctoring_evidence_media_type_check"
    CHECK ("media_type" IN ('camera', 'screen')),
  CONSTRAINT "proctoring_evidence_capture_reason_check"
    CHECK ("capture_reason" IN ('periodic', 'event')),
  CONSTRAINT "proctoring_evidence_capture_slot_check"
    CHECK (("capture_reason" = 'periodic' AND "capture_slot" BETWEEN 0 AND 29) OR
           ("capture_reason" = 'event' AND "capture_slot" BETWEEN 0 AND 4)),
  CONSTRAINT "proctoring_evidence_status_check"
    CHECK ("status" IN ('intent', 'confirming', 'ready', 'processing', 'processed', 'unavailable', 'rejected', 'expired')),
  CONSTRAINT "proctoring_evidence_content_type_check"
    CHECK ("content_type" IN ('image/jpeg', 'image/webp')),
  CONSTRAINT "proctoring_evidence_max_bytes_check"
    CHECK ("max_bytes" BETWEEN 1 AND 4194304),
  CONSTRAINT "proctoring_evidence_byte_size_check"
    CHECK ("byte_size" IS NULL OR "byte_size" BETWEEN 1 AND "max_bytes"),
  CONSTRAINT "proctoring_evidence_sha256_check"
    CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "proctoring_evidence_time_window_check"
    CHECK ("intent_expires_at" > "created_at" AND
      (("confirmed_at" IS NULL AND "expires_at" IS NULL) OR
       ("confirmed_at" IS NOT NULL AND "expires_at" IS NOT NULL AND
        "expires_at" > "confirmed_at" AND
        "expires_at" <= "confirmed_at" + INTERVAL '7 days'))),
  CONSTRAINT "proctoring_evidence_confirmed_state_check"
    CHECK (("status" <> 'intent' OR
      ("sealed_object_key" IS NULL AND "byte_size" IS NULL AND "sha256" IS NULL AND
       "confirmed_at" IS NULL AND "processed_at" IS NULL)) AND
      ("status" NOT IN ('ready', 'processing', 'processed', 'unavailable') OR
      ("sealed_object_key" IS NOT NULL AND "byte_size" IS NOT NULL AND
       "sha256" IS NOT NULL AND "staging_etag" IS NOT NULL AND
       "confirmed_at" IS NOT NULL AND "expires_at" IS NOT NULL))),
  CONSTRAINT "proctoring_evidence_processing_time_check"
    CHECK ("processed_at" IS NULL OR "status" IN ('processed', 'unavailable', 'expired')),
  CONSTRAINT "proctoring_evidence_deleted_state_check"
    CHECK ("deleted_at" IS NULL OR "status" = 'expired')
);

CREATE UNIQUE INDEX "proctoring_evidence_id_organization_id_key"
  ON "proctoring_evidence" ("id", "organization_id");
CREATE UNIQUE INDEX "proctoring_evidence_session_id_client_capture_id_key"
  ON "proctoring_evidence" ("session_id", "client_capture_id");
CREATE UNIQUE INDEX "proctoring_evidence_session_media_reason_slot_key"
  ON "proctoring_evidence" ("session_id", "media_type", "capture_reason", "capture_slot");
CREATE UNIQUE INDEX "proctoring_evidence_staging_object_key_key"
  ON "proctoring_evidence" ("staging_object_key");
CREATE UNIQUE INDEX "proctoring_evidence_sealed_object_key_key"
  ON "proctoring_evidence" ("sealed_object_key");
CREATE INDEX "proctoring_evidence_organization_id_session_id_created_at_idx"
  ON "proctoring_evidence" ("organization_id", "session_id", "created_at");
CREATE INDEX "proctoring_evidence_organization_id_assignment_id_idx"
  ON "proctoring_evidence" ("organization_id", "assignment_id");
CREATE INDEX "proctoring_evidence_status_expires_at_idx"
  ON "proctoring_evidence" ("status", "expires_at");
CREATE INDEX "proctoring_evidence_status_intent_expires_at_idx"
  ON "proctoring_evidence" ("status", "intent_expires_at");

CREATE TABLE "proctoring_findings" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "detector" VARCHAR(64) NOT NULL,
  "model_revision" VARCHAR(128) NOT NULL,
  "label" VARCHAR(64) NOT NULL,
  "result_kind" VARCHAR(16) NOT NULL,
  "confidence" DOUBLE PRECISION,
  "detected_count" INTEGER,
  "failure_code" VARCHAR(64),
  "inferred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proctoring_findings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proctoring_findings_evidence_tenant_fkey"
    FOREIGN KEY ("evidence_id", "organization_id")
    REFERENCES "proctoring_evidence" ("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proctoring_findings_detector_check"
    CHECK ("detector" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "proctoring_findings_label_check"
    CHECK ("label" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "proctoring_findings_failure_code_check"
    CHECK ("failure_code" IS NULL OR "failure_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "proctoring_findings_result_check"
    CHECK (("result_kind" = 'signal' AND "detected_count" IS NOT NULL AND
            "detected_count" BETWEEN 0 AND 100 AND
            ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1) AND
            "failure_code" IS NULL) OR
           ("result_kind" = 'unavailable' AND "confidence" IS NULL AND
            "detected_count" IS NULL AND "failure_code" IS NOT NULL))
);

CREATE UNIQUE INDEX "proctoring_findings_evidence_detector_revision_label_key"
  ON "proctoring_findings" ("evidence_id", "detector", "model_revision", "label");
CREATE INDEX "proctoring_findings_organization_id_evidence_id_inferred_at_idx"
  ON "proctoring_findings" ("organization_id", "evidence_id", "inferred_at");

CREATE TABLE "proctoring_inference_outbox" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatched_at" TIMESTAMP(3),
  "last_error_code" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proctoring_inference_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proctoring_inference_outbox_evidence_tenant_fkey"
    FOREIGN KEY ("evidence_id", "organization_id")
    REFERENCES "proctoring_evidence" ("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proctoring_inference_outbox_status_check"
    CHECK ("status" IN ('pending', 'sending', 'dispatched', 'dead')),
  CONSTRAINT "proctoring_inference_outbox_attempt_count_check"
    CHECK ("attempt_count" BETWEEN 0 AND 10),
  CONSTRAINT "proctoring_inference_outbox_error_code_check"
    CHECK ("last_error_code" IS NULL OR "last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE UNIQUE INDEX "proctoring_inference_outbox_evidence_id_key"
  ON "proctoring_inference_outbox" ("evidence_id");
CREATE UNIQUE INDEX "proctoring_inference_outbox_evidence_id_organization_id_key"
  ON "proctoring_inference_outbox" ("evidence_id", "organization_id");
CREATE INDEX "proctoring_inference_outbox_status_available_at_idx"
  ON "proctoring_inference_outbox" ("status", "available_at");
CREATE INDEX "proctoring_inference_outbox_organization_id_status_idx"
  ON "proctoring_inference_outbox" ("organization_id", "status");

-- A valid-looking UPDATE must not replace a sealed image or resurrect expired
-- evidence. This also protects privileged maintenance code from accidental
-- identity changes; media deletion marks the row expired instead.
CREATE FUNCTION proctoring_evidence_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.organization_id, OLD.assignment_id, OLD.session_id,
         OLD.client_capture_id, OLD.media_type, OLD.capture_reason,
         OLD.capture_slot, OLD.staging_object_key, OLD.content_type,
         OLD.max_bytes, OLD.intent_expires_at, OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.organization_id, NEW.assignment_id, NEW.session_id,
         NEW.client_capture_id, NEW.media_type, NEW.capture_reason,
         NEW.capture_slot, NEW.staging_object_key, NEW.content_type,
         NEW.max_bytes, NEW.intent_expires_at, NEW.created_at) THEN
    RAISE EXCEPTION 'proctoring evidence intent identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('ready', 'processing', 'processed', 'unavailable', 'expired')
     AND ROW(OLD.sealed_object_key, OLD.byte_size, OLD.sha256,
             OLD.staging_etag, OLD.sealed_etag, OLD.model_revision,
             OLD.confirmed_at, OLD.expires_at)
         IS DISTINCT FROM
         ROW(NEW.sealed_object_key, NEW.byte_size, NEW.sha256,
             NEW.staging_etag, NEW.sealed_etag, NEW.model_revision,
             NEW.confirmed_at, NEW.expires_at) THEN
    RAISE EXCEPTION 'sealed proctoring evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'intent' AND NEW.status IN ('confirming', 'rejected', 'expired')) OR
    (OLD.status = 'confirming' AND NEW.status IN ('intent', 'ready', 'rejected', 'expired')) OR
    (OLD.status = 'ready' AND NEW.status IN ('processing', 'processed', 'unavailable', 'expired')) OR
    (OLD.status = 'processing' AND NEW.status IN ('processed', 'unavailable', 'expired')) OR
    (OLD.status IN ('processed', 'unavailable', 'rejected') AND NEW.status = 'expired')
  ) THEN
    RAISE EXCEPTION 'invalid proctoring evidence status transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER proctoring_evidence_guard_update
BEFORE UPDATE ON "proctoring_evidence"
FOR EACH ROW EXECUTE FUNCTION proctoring_evidence_guard_update();

-- The tenant role can update only processing fields. Privileged, audited
-- retention cleanup uses a separate owner role and is never candidate-facing.
REVOKE ALL ON "proctoring_evidence", "proctoring_findings", "proctoring_inference_outbox" FROM app_tenant;
GRANT SELECT, INSERT ON "proctoring_evidence" TO app_tenant;
GRANT UPDATE ("status", "sealed_object_key", "byte_size", "sha256",
  "staging_etag", "sealed_etag", "model_revision", "confirmed_at", "expires_at",
  "processed_at", "deleted_at", "failure_code", "updated_at") ON "proctoring_evidence" TO app_tenant;
GRANT SELECT, INSERT ON "proctoring_findings" TO app_tenant;
GRANT SELECT, INSERT ON "proctoring_inference_outbox" TO app_tenant;
GRANT UPDATE ("status", "attempt_count", "available_at", "dispatched_at",
  "last_error_code", "updated_at") ON "proctoring_inference_outbox" TO app_tenant;

ALTER TABLE "proctoring_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "proctoring_evidence"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
ALTER TABLE "proctoring_findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_findings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "proctoring_findings"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
ALTER TABLE "proctoring_inference_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_inference_outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "proctoring_inference_outbox"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- A candidate may submit one immutable explanation after completing a
-- proctored assessment and before a staff review. Composite FKs bind it to
-- that candidate, assignment, session, and tenant. The API enforces the
-- review deadline; the database also bounds text and its retention window.
CREATE UNIQUE INDEX "assessment_assignments_id_org_candidate_key"
  ON "assessment_assignments" ("id", "organization_id", "candidate_id");

CREATE TABLE "proctoring_candidate_explanations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "text" VARCHAR(2000) NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proctoring_candidate_explanations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proctoring_candidate_explanations_assignment_tenant_fkey"
    FOREIGN KEY ("assignment_id", "organization_id", "candidate_id")
    REFERENCES "assessment_assignments" ("id", "organization_id", "candidate_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proctoring_candidate_explanations_session_tenant_fkey"
    FOREIGN KEY ("session_id", "organization_id", "assignment_id")
    REFERENCES "proctoring_sessions" ("id", "organization_id", "assignment_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proctoring_candidate_explanations_text_check"
    CHECK (char_length(btrim("text")) BETWEEN 1 AND 2000),
  CONSTRAINT "proctoring_candidate_explanations_retention_check"
    CHECK ("expires_at" > "submitted_at"
      AND "expires_at" <= "submitted_at" + INTERVAL '7 days')
);

CREATE UNIQUE INDEX "proctoring_candidate_explanations_session_id_key"
  ON "proctoring_candidate_explanations" ("session_id");
CREATE UNIQUE INDEX "proctoring_candidate_explanations_session_tenant_key"
  ON "proctoring_candidate_explanations" ("session_id", "organization_id", "assignment_id");
CREATE INDEX "proctoring_candidate_explanations_organization_assignment_idx"
  ON "proctoring_candidate_explanations" ("organization_id", "assignment_id");
CREATE INDEX "proctoring_candidate_explanations_expires_at_idx"
  ON "proctoring_candidate_explanations" ("expires_at");

REVOKE ALL ON "proctoring_candidate_explanations" FROM app_tenant;
GRANT SELECT, INSERT ON "proctoring_candidate_explanations" TO app_tenant;
ALTER TABLE "proctoring_candidate_explanations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_candidate_explanations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "proctoring_candidate_explanations"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
