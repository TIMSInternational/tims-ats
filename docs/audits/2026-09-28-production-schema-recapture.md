# Production schema baseline recapture — 2026-09-28

Read-only checks against the live PostgreSQL 17 database found that RLS tenant isolation and `app_tenant` least-privilege grants pass, but the committed schema baseline from August 4 no longer matches production. The recapture in this change records only these differences:

- `assessment_assignments.reminder_attempted_at`, defined by `20260928120000_assessment_reminder_attempt/migration.sql` and used by the deployed assessment-reminder flow.
- `audit_logs_organization_id_action_idx`, defined by `20260810000000_audit_logs_action_index/migration.sql`.
- The existing `ci_readonly` role's SELECT grants on 119 public tables and `supabase_migrations.schema_migrations`, USAGE on both schemas, and the default SELECT privilege for future public tables. These match the access specified in `.github/workflows/nightly-db-controls.yml`. The role is LOGIN, NOINHERIT, NOBYPASSRLS, is a member of `app_tenant`, and has no application write grants.

The two migration names were not found in `supabase_migrations.schema_migrations`; their SQL files and the live objects establish the intended schema, but the migration ledger does not establish how they were applied. This recapture does not change production DDL or grants.

All five `services/Tims.Platform/db/flip-ddl/*.sql` bootstrap artifacts were regenerated from the captured baseline. Their generator identity tests pass; they now carry the optional, role-existence-guarded `ci_readonly` SELECT grants as well as the updated source timestamp.

The nightly controls still cannot run in GitHub Actions because the repository has no `PROD_DIRECT_URL` secret. Local read-only checks 14 (RLS) and 17 (least privilege) pass. Check 16 passes against the recaptured baseline, but scheduled verification remains unavailable until the existing `ci_readonly` credential is installed as a GitHub secret and the workflow is rerun.
