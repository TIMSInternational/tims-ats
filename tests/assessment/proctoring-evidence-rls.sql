-- Run with `psql -v ON_ERROR_STOP=1 -f tests/assessment/proctoring-evidence-rls.sql`
-- against a fresh, isolated PostgreSQL database. Minimal parents plus the real
-- migration run in one transaction; nothing persists after the proof.
\set ON_ERROR_STOP on
BEGIN;

CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_tenant;
CREATE TABLE assessment_assignments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL
);
CREATE TABLE proctoring_sessions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  assignment_id UUID NOT NULL
);
CREATE TABLE proctoring_events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  CONSTRAINT proctoring_events_type_check CHECK (type IN (
    'tab_hidden', 'focus_lost', 'camera_stopped', 'screen_share_stopped',
    'face_missing', 'multiple_faces', 'model_unavailable', 'heartbeat_gap'))
);
\ir ../../packages/db/prisma/migrations/20260924100000_proctoring_evidence_foundation/migration.sql

INSERT INTO proctoring_events (id, type) VALUES
  ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'media_capture_stopped');

INSERT INTO assessment_assignments (id, organization_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');
INSERT INTO proctoring_sessions (id, organization_id, assignment_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DO $$ BEGIN
  BEGIN
    UPDATE proctoring_sessions SET media_consent_version = 'media-v1'
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000000';
    RAISE EXCEPTION 'media consent version without timestamp was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE proctoring_sessions SET media_consented_at = CURRENT_TIMESTAMP,
    media_consent_version = 'media-v1'
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000000';
UPDATE proctoring_sessions SET media_stopped_at = CURRENT_TIMESTAMP
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000000';
DO $$ BEGIN
  BEGIN
    UPDATE proctoring_sessions SET media_stopped_at = NULL
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000000';
    RAISE EXCEPTION 'media stop was cleared';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- A complete second-tenant row proves SELECT isolation for all three tables.
INSERT INTO proctoring_evidence
  (id, organization_id, assignment_id, session_id, client_capture_id,
   media_type, capture_reason, capture_slot, staging_object_key, content_type,
   max_bytes, intent_expires_at)
VALUES
  ('bbbbbbbb-1000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-000000000000',
   'bbbbbbbb-2000-0000-0000-000000000000', 'camera', 'periodic', 0,
   'tenant-b/staging/first.jpg', 'image/jpeg', 1048576, CURRENT_TIMESTAMP + INTERVAL '10 minutes');
UPDATE proctoring_evidence SET status = 'confirming'
  WHERE id = 'bbbbbbbb-1000-0000-0000-000000000000';
UPDATE proctoring_evidence SET status = 'ready',
    sealed_object_key = 'tenant-b/sealed/first.jpg', byte_size = 100,
    sha256 = repeat('b', 64), staging_etag = 'etag-b', sealed_etag = 'sealed-etag-b',
    confirmed_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP + INTERVAL '7 days'
  WHERE id = 'bbbbbbbb-1000-0000-0000-000000000000';
INSERT INTO proctoring_findings
  (id, organization_id, evidence_id, detector, model_revision, label,
   result_kind, confidence, detected_count)
VALUES
  ('bbbbbbbb-3000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-1000-0000-0000-000000000000', 'rekognition_faces', 'face-v1',
   'face', 'signal', 0.9, 1);
INSERT INTO proctoring_inference_outbox (id, organization_id, evidence_id)
VALUES ('bbbbbbbb-4000-0000-0000-000000000000',
        '22222222-2222-2222-2222-222222222222',
        'bbbbbbbb-1000-0000-0000-000000000000');
INSERT INTO proctoring_evidence
  (id, organization_id, assignment_id, session_id, client_capture_id,
   media_type, capture_reason, capture_slot, staging_object_key, content_type,
   max_bytes, intent_expires_at)
VALUES
  ('bbbbbbbb-1000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-000000000000',
   'bbbbbbbb-2000-0000-0000-000000000001', 'camera', 'periodic', 1,
   'tenant-b/staging/second.jpg', 'image/jpeg', 1048576, CURRENT_TIMESTAMP + INTERVAL '10 minutes');

SET ROLE app_tenant;
SET app.current_org_id = '11111111-1111-1111-1111-111111111111';

DO $$ BEGIN
  IF (SELECT count(*) FROM proctoring_evidence) <> 0 OR
     (SELECT count(*) FROM proctoring_findings) <> 0 OR
     (SELECT count(*) FROM proctoring_inference_outbox) <> 0 THEN
    RAISE EXCEPTION 'second-tenant evidence metadata is visible';
  END IF;
END $$;

INSERT INTO proctoring_evidence
  (id, organization_id, assignment_id, session_id, client_capture_id,
   media_type, capture_reason, capture_slot, staging_object_key, content_type,
   max_bytes, intent_expires_at)
VALUES
  ('aaaaaaaa-1000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-000000000000',
   'aaaaaaaa-2000-0000-0000-000000000000', 'camera', 'periodic', 0,
   'tenant-a/staging/first.jpg', 'image/jpeg', 1048576, CURRENT_TIMESTAMP + INTERVAL '10 minutes');

DO $$ BEGIN
  IF (SELECT count(*) FROM proctoring_evidence) <> 1 THEN
    RAISE EXCEPTION 'own evidence disappeared or second-tenant evidence leaked';
  END IF;

  BEGIN
    INSERT INTO proctoring_evidence
      (id, organization_id, assignment_id, session_id, client_capture_id,
       media_type, capture_reason, capture_slot, staging_object_key, content_type,
       max_bytes, intent_expires_at)
    VALUES
      ('aaaaaaaa-1000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-000000000000',
       'aaaaaaaa-2000-0000-0000-000000000000', 'camera', 'periodic', 1,
       'tenant-a/staging/duplicate-client.jpg', 'image/jpeg', 1000, CURRENT_TIMESTAMP + INTERVAL '10 minutes');
    RAISE EXCEPTION 'duplicate client capture ID was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proctoring_evidence
      (id, organization_id, assignment_id, session_id, client_capture_id,
       media_type, capture_reason, capture_slot, staging_object_key, content_type,
       max_bytes, intent_expires_at)
    VALUES
      ('aaaaaaaa-1000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-000000000000',
       'aaaaaaaa-2000-0000-0000-000000000002', 'camera', 'periodic', 0,
       'tenant-a/staging/duplicate-slot.jpg', 'image/jpeg', 1000, CURRENT_TIMESTAMP + INTERVAL '10 minutes');
    RAISE EXCEPTION 'duplicate periodic slot was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proctoring_evidence
      (id, organization_id, assignment_id, session_id, client_capture_id,
       media_type, capture_reason, capture_slot, staging_object_key, content_type,
       max_bytes, intent_expires_at)
    VALUES
      ('aaaaaaaa-1000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-000000000000',
       'aaaaaaaa-2000-0000-0000-000000000003', 'camera', 'periodic', 30,
       'tenant-a/staging/over-cap.jpg', 'image/jpeg', 1000, CURRENT_TIMESTAMP + INTERVAL '10 minutes');
    RAISE EXCEPTION 'periodic capture cap was not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proctoring_evidence
      (id, organization_id, assignment_id, session_id, client_capture_id,
       media_type, capture_reason, capture_slot, staging_object_key, content_type,
       max_bytes, intent_expires_at)
    VALUES
      ('aaaaaaaa-1000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-0000-0000-0000-000000000000',
       'aaaaaaaa-2000-0000-0000-000000000004', 'screen', 'periodic', 1,
       'tenant-a/staging/cross-assignment.jpg', 'image/jpeg', 1000, CURRENT_TIMESTAMP + INTERVAL '10 minutes');
    RAISE EXCEPTION 'cross-tenant assignment was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proctoring_evidence
      (id, organization_id, assignment_id, session_id, client_capture_id,
       media_type, capture_reason, capture_slot, staging_object_key, content_type,
       max_bytes, intent_expires_at)
    VALUES
      ('aaaaaaaa-1000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-000000000000',
       'aaaaaaaa-2000-0000-0000-000000000005', 'camera', 'periodic', 1,
       'tenant-b/staging/injected.jpg', 'image/jpeg', 1000, CURRENT_TIMESTAMP + INTERVAL '10 minutes');
    RAISE EXCEPTION 'RLS WITH CHECK accepted another tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE proctoring_evidence SET status = 'ready'
      WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
    RAISE EXCEPTION 'intent skipped confirmation and sealing';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE proctoring_evidence SET staging_object_key = 'tampered-key'
      WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
    RAISE EXCEPTION 'tenant role modified immutable object key';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

UPDATE proctoring_evidence SET status = 'confirming'
  WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
UPDATE proctoring_evidence SET status = 'intent'
  WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
UPDATE proctoring_evidence SET status = 'confirming'
  WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
DO $$ BEGIN
  BEGIN
    UPDATE proctoring_evidence SET status = 'ready',
        sealed_object_key = 'tenant-a/sealed/too-long.jpg', byte_size = 100,
        sha256 = repeat('a', 64), staging_etag = 'etag-a',
        confirmed_at = CURRENT_TIMESTAMP,
        expires_at = CURRENT_TIMESTAMP + INTERVAL '8 days'
      WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
    RAISE EXCEPTION 'more than seven days of media retention was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE proctoring_evidence SET status = 'ready',
    sealed_object_key = 'tenant-a/sealed/first.jpg', byte_size = 100,
    sha256 = repeat('a', 64), staging_etag = 'etag-a', sealed_etag = 'sealed-etag-a',
    confirmed_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP + INTERVAL '7 days'
  WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';

DO $$ BEGIN
  BEGIN
    UPDATE proctoring_evidence SET sealed_object_key = 'tenant-a/sealed/replacement.jpg'
      WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
    RAISE EXCEPTION 'sealed object key was changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE proctoring_evidence SET expires_at = CURRENT_TIMESTAMP + INTERVAL '8 days'
      WHERE id = 'aaaaaaaa-1000-0000-0000-000000000000';
    RAISE EXCEPTION 'seven-day retention cap was bypassed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM proctoring_evidence;
    RAISE EXCEPTION 'tenant role deleted evidence';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

INSERT INTO proctoring_findings
  (id, organization_id, evidence_id, detector, model_revision, label,
   result_kind, confidence, detected_count)
VALUES
  ('aaaaaaaa-3000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-1000-0000-0000-000000000000', 'rekognition_faces', 'face-v1',
   'face', 'signal', NULL, 0);
INSERT INTO proctoring_inference_outbox (id, organization_id, evidence_id)
VALUES ('aaaaaaaa-4000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-1000-0000-0000-000000000000');

DO $$ BEGIN
  IF (SELECT count(*) FROM proctoring_findings) <> 1 OR
     (SELECT count(*) FROM proctoring_inference_outbox) <> 1 THEN
    RAISE EXCEPTION 'finding or outbox RLS leaked another tenant';
  END IF;

  BEGIN
    INSERT INTO proctoring_findings
      (id, organization_id, evidence_id, detector, model_revision, label,
       result_kind, confidence, detected_count)
    VALUES
      ('aaaaaaaa-3000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
       'bbbbbbbb-1000-0000-0000-000000000001', 'rekognition_faces', 'face-v1',
       'face', 'signal', 0.9, 1);
    RAISE EXCEPTION 'finding linked another tenant evidence';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proctoring_inference_outbox (id, organization_id, evidence_id)
    VALUES ('aaaaaaaa-4000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            'bbbbbbbb-1000-0000-0000-000000000001');
    RAISE EXCEPTION 'outbox linked another tenant evidence';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proctoring_findings
      (id, organization_id, evidence_id, detector, model_revision, label,
       result_kind, confidence, detected_count)
    VALUES
      ('aaaaaaaa-3000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
       'aaaaaaaa-1000-0000-0000-000000000000', 'hf_objects', 'model-v1',
       'phone', 'signal', 1.5, 1);
    RAISE EXCEPTION 'out-of-range model confidence was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE proctoring_findings SET confidence = 0.1;
    RAISE EXCEPTION 'append-only finding was updated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM proctoring_findings;
    RAISE EXCEPTION 'append-only finding was deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET app.current_org_id;
DO $$ BEGIN
  IF (SELECT count(*) FROM proctoring_evidence) <> 0 OR
     (SELECT count(*) FROM proctoring_findings) <> 0 OR
     (SELECT count(*) FROM proctoring_inference_outbox) <> 0 THEN
    RAISE EXCEPTION 'unset tenant context did not fail closed';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
