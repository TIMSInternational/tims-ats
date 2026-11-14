-- OWNER STEP (round 11, owner default D6): give ONE organization's seeded 'leader' role assessment:read at TEAM
-- scope, so a team leader reaches the D6 assessment view (only "below minimum", never the level or CEFR) for the
-- vacancies of the teams they lead. Without it the seeded leader has no assessment grant and sees no assessments card.
-- It does not unlock a candidate's essay answers: listing and grading essays need company scope (Codex ats run 2).
--
-- Why an owner step and not a seed change: the role grants' single source of truth is
-- packages/db/prisma/seed-access-matrix.ts (mirrored into the embedded
-- services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/role-grants.json, with a parity test), and new grants
-- there only reach organizations provisioned afterwards. Existing organizations (the pilot tenant) need this row.
--
-- Run against the target database, once per organization, naming it explicitly:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v org_id=<organization uuid> -f services/Tims.Platform/db/owner/leader_assessment_read.sql
--
-- Idempotent: the permission and the grant are inserted only when missing. A leader that already holds assessment:read
-- at some scope keeps that scope (the grant is not widened or narrowed). Only the named organization is touched.
BEGIN;

INSERT INTO permissions (id, module, action, description)
SELECT gen_random_uuid(), 'assessment', 'read', 'assessment.read'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'assessment' AND action = 'read');

INSERT INTO role_permissions (id, role_id, permission_id, scope)
SELECT gen_random_uuid(), r.id, p.id, 'team'
FROM roles r
JOIN permissions p ON p.module = 'assessment' AND p.action = 'read'
WHERE r.organization_id = :'org_id'::uuid
  AND r.slug = 'leader'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- What the organization's leader role now holds for assessment (expect one row: read | team).
SELECT p.action, rp.scope
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id AND p.module = 'assessment'
WHERE r.organization_id = :'org_id'::uuid AND r.slug = 'leader';

COMMIT;
