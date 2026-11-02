# Parity Verification Harness

This harness validates that the C#/.NET backend and TypeScript backend produce identical output for the same inputs across all major workflows (candidate flows, assessments, evaluations, etc.). Run `cp .env.example .env`, fill in the `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` from the Supabase dashboard, then execute `npx tsx scripts/parity/cli.ts verify compensation` to trigger a full parity suite covering Candidate, Team, Intel, and premium assessments. All differences are logged to stdout; the harness exits with code 0 only if both backends agree on every output field.

## Database connection over IPv4 (`PARITY_DATABASE_URL`)

`seed`, `seed --teardown`, every `verify-write`, and any `verify` of a surface with a by-id endpoint open a direct
Postgres connection. `DATABASE_URL` normally points at `db.<project-ref>.supabase.co`, which Supabase serves over
**IPv6 only** — on a machine or CI runner without IPv6 those commands fail with `ENOTFOUND` before running anything.

Set `PARITY_DATABASE_URL` to the Supabase **session pooler** connection string instead (Dashboard → Connect →
Session pooler: host `aws-0-<region>.pooler.supabase.com`, port `5432`, user `postgres.<project-ref>`). It is
harness-only and **takes precedence over `DATABASE_URL`** when set and non-blank, so nothing else that reads
`DATABASE_URL` changes. A value exported in the shell beats one in `scripts/parity/.env`:

```bash
PARITY_DATABASE_URL='postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  npx tsx scripts/parity/cli.ts verify tenant-org-structure
```

TLS is unchanged: the connection still pins `scripts/parity/supabase-root-ca.pem` with full verification
(`rejectUnauthorized: true`, hostname checked). Because `pg` lets `ssl*`/`sslmode` query parameters in a connection
string **replace** that pinned config, an override carrying any of them is refused — paste the URI without
`?sslmode=…`. Use the session pooler (5432), not the transaction pooler (6543). Precedence and the refusal are
unit-tested in `config.test.ts` (`resolveDatabaseUrl`, `mergeEnv`).

## Teardown after an audited `verify-write`

`audit_logs` is append-only in production (`packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql`,
`ENABLE ALWAYS`; present in `packages/db/baseline/prod-public-schema.sql`, not re-checked against the live database
for this note), and its `organization_id` FK cascades on delete while `actor_id` is `ON DELETE SET NULL`. So once
any `verify-write` that writes an audit row has run against the parity orgs (organization, access-review,
assessment-types, tenant-org-structure, tenant-org-people, …), `seed --teardown`'s user and organization DELETEs are
refused by the guard. The org-structure surfaces are therefore designed to be re-run WITHOUT a teardown: their
`ensurePreconditions` hook resets every fixture they touch and their audit read-backs assert "baseline + 1" rather
than "at least one".
