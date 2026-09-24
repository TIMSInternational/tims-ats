-- Run against an isolated PostgreSQL database AFTER the proctoring migration.
-- This is a database permission proof, not a mock. It assumes a test-only
-- app_tenant role and minimal assessment_assignments/proctoring_sessions tables.
INSERT INTO assessment_assignments (id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO proctoring_sessions (id, organization_id, assignment_id, started_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', CURRENT_TIMESTAMP),
  ('bbbbbbbb-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', CURRENT_TIMESTAMP);
INSERT INTO proctoring_events (id, organization_id, session_id, client_event_id, type, source, severity)
  VALUES ('bbbbbbbb-1000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
    'bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-2000-0000-0000-000000000000',
    'heartbeat_gap', 'server_inferred', 'medium');

SET ROLE app_tenant;
SET app.current_org_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO proctoring_events (id, organization_id, session_id, client_event_id, type, source, severity)
  VALUES ('aaaaaaaa-1000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-2000-0000-0000-000000000000',
    'tab_hidden', 'client_observation', 'low');

DO $$ BEGIN
  IF (SELECT count(*) FROM proctoring_events) <> 1 THEN
    RAISE EXCEPTION 'tenant SELECT leaked another organization';
  END IF;
  BEGIN
    UPDATE proctoring_events SET severity = 'medium';
    RAISE EXCEPTION 'app_tenant unexpectedly updated an event';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM proctoring_events;
    RAISE EXCEPTION 'app_tenant unexpectedly deleted an event';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO proctoring_events (id, organization_id, session_id, client_event_id, type, source, severity)
      VALUES ('aaaaaaaa-1000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'bbbbbbbb-0000-0000-0000-000000000000', 'aaaaaaaa-2000-0000-0000-000000000001',
        'tab_hidden', 'client_observation', 'low');
    RAISE EXCEPTION 'cross-tenant session FK unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO proctoring_events (id, organization_id, session_id, client_event_id, type, source, severity)
      VALUES ('aaaaaaaa-1000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-2000-0000-0000-000000000000',
        'tab_hidden', 'client_observation', 'low');
    RAISE EXCEPTION 'duplicate idempotency key unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

RESET ROLE;
