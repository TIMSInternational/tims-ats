# Backup & Restore Runbook

> Owner: NexaDev LLC · Applies to: production Supabase Postgres 17.6 (`public` + `auth`)
> Automation: `.github/workflows/backup-restore-drill.yml` → `scripts/backup-drill/run-drill.sh`

## 1. What the weekly drill proves, and what it does not

**It proves** that a logical dump of production:

- can be taken at one consistent snapshot (`pg_export_snapshot()` + `pg_dump --snapshot`);
- restores cleanly into an empty Postgres of the same version (`supabase/postgres:17.6.1.178`, pinned
  by digest), with **no restore errors** (the allow-list is empty; any error fails the drill);
- is **complete**: the exact `count(*)` of every table in `public` and `auth`, taken inside the dump's
  snapshot, equals the restored count; and the schema inventory of both schemas (tables, columns,
  defaults, indexes, constraints, RLS enabled/forced flags, policies with their roles and
  expressions, triggers including their enabled state, full function definitions — body, SECURITY
  DEFINER, SET clauses, volatility — and enum labels in order, domains and composite types) is
  identical;
- comes from a source that is not empty: at least `DRILL_MIN_TABLES` tables, at least `DRILL_MIN_ROWS`
  rows in total, and rows in `auth.users` and `public.organizations` — otherwise exit 2, because an
  all-empty database restores "exactly" and would prove nothing;
- and it measures the logical-restore RTO floor (dump + restore seconds) and the dump size.

**It does NOT prove:**

| Not covered                                  | Why / where it is covered instead                                                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase's managed daily backups / PITR work | Only Supabase can restore those. **Quarterly manual step**, section 4.                                                                                                                                                                                                |
| That a backup EXISTS                         | The drill keeps nothing: its dump is deleted at the end of the job. It is a test of the restore path, not a backup. The backups are Supabase's (section 4).                                                                                                           |
| `storage`, `vault`, `realtime`, `graphql`    | `storage`: no app code uses Supabase Storage (CVs live in S3). `vault`: secrets are encrypted with a per-project key and would not decrypt in another database. The rest are platform-managed.                                                                        |
| `supabase_migrations` history ledger         | Excluded to keep the first version minimal; add it to `DRILL_SCHEMAS` if a restore should carry it.                                                                                                                                                                   |
| Role attributes, passwords and memberships   | Roles are cluster-level and never in a `pg_dump`. The drill creates missing role _names_ as bare `NOLOGIN` roles so policies and GRANTs restore. A real restore must recreate them properly (section 5).                                                              |
| Sequence values                              | Not compared: sequences are non-transactional, so a busy sequence could differ between the count and the dump without anything being wrong. `pg_dump` does include them.                                                                                              |
| GRANTs / ownership                           | GRANTs are restored (and would fail the drill if a grantee were missing) but not compared. Ownership is dropped (`--no-owner`).                                                                                                                                       |
| Bearer-token rows                            | The DATA of `auth.refresh_tokens`, `sessions`, `mfa_amr_claims`, `one_time_tokens`, `flow_state`, `saml_relay_states` is left out of the drill's dump (`DRILL_EXCLUDE_TABLE_DATA`); those tables must restore present and empty. `capture` (path B) still dumps them. |
| That the source is production                | Only if the optional `PROD_DB_SYSTEM_IDENTIFIER` repo variable is set (section 2, step 7). Without it, a _different_ populated database that clears the floors would verify; the summary says "NOT pinned".                                                           |

## 2. One-time setup (Federico)

1. Check that statement logging will not capture the password: run `SHOW log_statement;` in the
   Supabase SQL editor. If it is `ddl` or `all`, the `ALTER ROLE … PASSWORD` in step 2 would be
   logged: pass a throwaway 32-character value in step 2, then immediately set the real password with
   psql's `\password backup_drill_reader`, which sends only a SCRAM hash.

2. Create the read-only drill role, as `postgres`, over the session pooler, from the repo root:

   ```bash
   read -rs DRILL_PW
   ```

   Paste a fresh random password of 32+ characters (e.g. from your password manager), press Enter, then:

   ```bash
   psql "$ADMIN_SESSION_POOLER_URL" -v password="$DRILL_PW" -f scripts/backup-drill/create-drill-role.sql
   ```

   The role gets SELECT on the tables and sequences of `public` and `auth` only. The `auth` tables
   belong to `supabase_auth_admin`, and in the `supabase/postgres` image `postgres` cannot grant on
   them, so **expect this first run to stop** with "postgres cannot grant SELECT on the auth schema"
   (nothing is committed). Then choose one:
   - **Keeps the scoping:** ask Supabase support to grant `SELECT` on all `auth` tables and sequences
     (and `USAGE` on schema `auth`) to `backup_drill_reader`, then re-run the command above.
   - **Broader, explicit:** re-run with `-v allow_read_all_data=1` appended. The role then gets
     `pg_read_all_data` — SELECT on **every** schema, including `vault`, `storage`, `cron`, `net`.
     Record that in the access register (#40).

   Either way the file ends with assertions (not superuser, BYPASSRLS, no role memberships except
   `pg_read_all_data` on the explicit fallback, can read every `public`/`auth` table, zero writable
   tables, connection limit 2) and rolls back if any fails. Re-running it is also how an older
   `pg_read_all_data` grant is revoked once Supabase has granted `auth`.

3. Create the GitHub Environment **before** storing the secret or running the workflow. If the job
   runs first, GitHub creates `prod-backup-drill` automatically **with no branch policy**.

   ```bash
   gh api -X PUT repos/TIMSInternational/tims-ats/environments/prod-backup-drill -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   ```

   ```bash
   gh api -X POST repos/TIMSInternational/tims-ats/environments/prod-backup-drill/deployment-branch-policies -f name=main -f type=branch
   ```

   Then check in Settings → Environments → `prod-backup-drill` that "Deployment branches and tags"
   lists `main` only. A required reviewer is optional: it would hold every Sunday run until someone
   approves it.

4. Store the secret **in the environment**, not in the repository. Use the **session pooler** host on
   port **5432** (GitHub runners have no IPv6, so the direct `db.<ref>.supabase.co` host is
   unreachable; the transaction pooler on 6543 cannot hold a snapshot). Do **not** add `sslmode` —
   the drill refuses a URL that carries one and enforces `verify-full` against the committed Supabase
   root CA itself.

   ```bash
   gh secret set PROD_BACKUP_DRILL_URL --env prod-backup-drill --repo TIMSInternational/tims-ats
   ```

   Paste `postgresql://backup_drill_reader.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres`
   at the prompt, so the URL never lands in shell history.

5. Delete any repository-level copy (it errors harmlessly if there is none), then confirm the first
   list below does NOT show `PROD_BACKUP_DRILL_URL` and the second does:

   ```bash
   gh secret delete PROD_BACKUP_DRILL_URL --repo TIMSInternational/tims-ats
   ```

   ```bash
   gh secret list --repo TIMSInternational/tims-ats
   ```

   ```bash
   gh secret list --env prod-backup-drill --repo TIMSInternational/tims-ats
   ```

   **Steps 3–5 are what make the credential's scoping real.** A repository secret is readable by any
   workflow run in this repository — a same-repo pull request can add a workflow that prints it, and
   a `workflow_dispatch` of an edited branch runs that branch's copy of this workflow. The drill's
   triggers (schedule/dispatch, never `pull_request`) do not prevent either, and its "Refuse to run
   outside main" step is defence in depth only: a branch that edits the workflow can delete it. An
   environment secret with a `main`-only branch policy is released only to jobs running from `main`.

6. Trigger the first run from `main` and watch it:

   ```bash
   gh workflow run backup-restore-drill.yml --ref main --repo TIMSInternational/tims-ats
   ```

   ```bash
   gh run watch --repo TIMSInternational/tims-ats
   ```

   Then raise `DRILL_MIN_ROWS` in the workflow (it starts at a conservative 1000) to about half the
   total rows the run reports, so a large loss of data is caught as exit 2.

7. Optional but recommended — pin the source identity so a different populated database cannot verify.
   Read production's identifier (as `postgres` or `backup_drill_reader`):
   `SELECT system_identifier FROM pg_control_system();` then store it as a repository **variable**
   (not a secret; it is not sensitive):

   ```bash
   gh variable set PROD_DB_SYSTEM_IDENTIFIER --repo TIMSInternational/tims-ats
   ```

   Paste the number at the prompt. After a restore to a new project or a Supabase-side migration the
   identifier changes and the drill exits 2 until the variable is updated — deliberately.

8. Record the role, the environment secret, and (if taken) the `pg_read_all_data` fallback in the
   access register (#40).

**First-run expectations.** The drill has only been proven end-to-end against a synthetic database
(`bash scripts/backup-drill/local-e2e.sh`). Against production the first run can legitimately fail in
three ways, each of which is a finding, not a flake:

- **exit 2, TLS**: the committed CA (`scripts/parity/supabase-root-ca.pem`) was captured from the direct
  host; #292 states the session pooler chains to it too. If `verify-full` fails, fix the CA — never
  lower the sslmode.
- **exit 2, identity**: the drill proves the restore target is a different cluster by comparing
  `pg_control_system().system_identifier` on both sides. It is executable by any role on stock
  Postgres and on the `supabase/postgres` image; if Supabase revokes it on the hosted project, the drill
  refuses to run rather than skip the check — grant EXECUTE on it to `backup_drill_reader`.
- **exit 2, floors / identity pin**: fewer rows than `DRILL_MIN_ROWS`, an empty `auth.users` or
  `public.organizations`, or a `system_identifier` that differs from `PROD_DB_SYSTEM_IDENTIFIER`. Check
  which database the secret points at before touching any threshold.
- **exit 2, permission denied while counting**: a table in `public` or `auth` that the role cannot
  read — e.g. created by a role other than `postgres` after step 2. Re-run step 2.
- **exit 1, a foreign-key error on an `auth` table**: a table that references one of the
  bearer-token tables whose data is excluded (production's GoTrue may be newer than the image's). Add
  it to `DRILL_EXCLUDE_TABLE_DATA` in the workflow if it is also session/token data; otherwise triage.
- **exit 1, restore errors**: production may carry objects the synthetic database did not (e.g. a
  publication membership or a function referencing another schema). Triage each error; if it is
  genuinely harmless, add a narrow pattern to `RESTORE_ALLOW_LIST` in `run-drill.sh` with a comment.
- **exit 1, inventory differs**: read the diff; it names the exact object.

## 3. Reading a result

| Exit | Step summary headline            | Meaning                                                                                                                                                                                                                                                      |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | ✅ Backup-restore drill VERIFIED | Restorable and complete at the snapshot. RTO and dump size in the table.                                                                                                                                                                                     |
| 1    | ❌ … FOUND N PROBLEM(S)          | The backup path is broken. Treat as an incident-severity finding; the log names objects.                                                                                                                                                                     |
| 2    | ⚠️ … DID NOT RUN                 | **Not a pass.** Missing secret, unreachable DB, lost BYPASSRLS, failed dump, or a source that is empty/too small (table + row floors, empty `auth.users`/`public.organizations`) or — only when `PROD_DB_SYSTEM_IDENTIFIER` is set — not the pinned cluster. |

Exit 1 and exit 2 both fail the job (same contract as the nightly DB controls, #124 / #38).

## 4. Quarterly: verify Supabase's managed backups (manual)

The drill cannot see Supabase's own backups. Once a quarter:

1. Supabase dashboard → the production project → **Database → Backups**. Confirm the most recent
   daily backup is from the last 24 hours, note the retention window, and whether PITR is enabled.
2. If the plan offers **restore to a new project**, restore the latest backup into a new, temporary
   project. Never test-restore over production.
3. Check the restored project. There is no exact oracle for a past backup — production has moved on
   since — so this is a plausibility check, not a proof: capture evidence from it
   (`run-drill.sh capture`, section 5) and compare its per-table counts and inventory against the
   latest weekly drill summary; schema must match exactly, counts should differ only by recent
   writes.
4. Delete the temporary project. Record the date, the backup timestamp restored and the result in
   the ops log.

## 5. Real restore during an incident

Decide first: **is production's database lost/corrupted, or is a subset of data wrong?**

### A. Preferred — Supabase managed restore

1. Declare the incident; stop writes (put the web app and C# API into maintenance, or scale App Runner
   to zero) so nothing writes to a database about to be replaced.
2. Dashboard → **Database → Backups** → choose the daily backup or PITR timestamp just before the
   damage. Restoring **in place** overwrites the current database and takes the project offline for
   the duration; restoring **to a new project** leaves production untouched for forensics.
3. If restored to a new project: recreate the project-specific roles with their real attributes
   (`app_tenant`, `ci_readonly`, `backup_drill_reader` — see each role's creating script), then update
   every consumer's connection strings (Vercel env, App Runner env, GitHub secrets) and the Supabase
   URL/anon/service keys. A new project has a new JWT secret: every session is invalidated and users
   must sign in again (password hashes in `auth.users` carry over).
4. Verify before reopening: run the nightly controls (checks 14, 16, 17) against the restored database,
   and `run-drill.sh verify` against evidence if you have any (see the end of path B).

### B. Logical dump, verified against evidence from the SAME snapshot

Possible whenever the source database is still readable (a degraded project, a migration, or a
subset of data that must be restored elsewhere). This is the only path with an exact oracle: the
evidence and the dump come from one `pg_export_snapshot()`, so the destination must match it exactly.
Use a PostgreSQL 17 client, from the repo root, on an encrypted disk you delete afterwards.

1. **Capture evidence and the dump together, from production, first.** With `DRILL_SOURCE_URL` set to
   a BYPASSRLS read-only URL (`backup_drill_reader`):

   ```bash
   bash scripts/backup-drill/run-drill.sh capture evidence.txt prod.dump
   ```

   `evidence.txt` holds only metadata (table names, exact row counts, schema definitions). `prod.dump`
   is production data: protect it and delete it at the end.

2. Create the new Supabase project (same region, Postgres 17), then recreate the project roles with
   their real attributes (not the drill's `NOLOGIN` stand-ins) — including `backup_drill_reader`
   (re-run `create-drill-role.sql`): its SELECT grants on `public` are in the dump, and `pg_restore`
   reports an error for every GRANT whose role is missing.
3. Restore `public`. A new project already has a `public` schema, and a dump taken with `-n public`
   carries `CREATE SCHEMA public`, so restoring over it fails with "schema public already exists".
   Do what the drill does (and `local-e2e.sh` scenario 13 proves, as a superuser on the image — not
   yet exercised as `postgres` on a hosted project): drop the **new project's** empty `public`, then
   restore it whole. First confirm `$NEW_DB_URL` really is the new project — its
   `SELECT system_identifier FROM pg_control_system();` must differ from production's and
   `SELECT count(*) FROM pg_tables WHERE schemaname = 'public';` must be `0`. Then:

   ```bash
   psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE'
   ```

   ```bash
   pg_restore --no-owner -n public -d "$NEW_DB_URL" prod.dump
   ```

   Any `pg_restore` error means stop and triage; do not continue past it.

4. Restore `auth` **data only** into the new project's GoTrue-managed tables:
   `pg_restore --data-only -n auth --disable-triggers -d "$NEW_DB_URL" prod.dump`. First confirm both
   projects run the same GoTrue version (column sets must match); if not, stop and open a Supabase
   support ticket.
5. **Verify the destination against the evidence before any cutover.** With `DRILL_VERIFY_URL` set to
   the new project's session-pooler URL for a BYPASSRLS role (e.g. `postgres`):

   ```bash
   bash scripts/backup-drill/run-drill.sh verify evidence.txt
   ```

   Exit 0 means every table's exact row count and the full schema inventory match the snapshot the
   dump was taken at. Exit 1 lists the tables/objects that differ — **do not cut over** while any
   difference is unexplained, in `public` or `auth`. Step 4 already required the same GoTrue version,
   so an `auth` inventory difference is not expected noise: it is either a version mismatch (go back to
   step 4) or an app-owned object in `auth` — a trigger or function on `auth.users`, say — that the
   `--data-only` restore of step 4 did not bring across. Recreate such objects from the dump
   (`pg_restore -l prod.dump` lists them; restore just those entries with `-L`), then re-run verify
   until it exits 0. Exit 2 means it could not verify (not a pass) — this includes evidence whose
   counts fall below the table/row floors or have an empty `auth.users` / `public.organizations`.

6. Cut consumers over as in A.3, run the nightly controls as in A.4, then delete `prod.dump`.

For path A there is no same-snapshot evidence (the original is gone or has moved on). If the original
database is still readable when you decide to restore, run step 1 (evidence only:
`run-drill.sh capture evidence.txt`) before touching anything, and verify the restored project
against it — expecting count differences only for writes after the restore point.

**Never** run `pg_restore --clean` against the existing production database. The drill's destructive
preparation is guarded (loopback-only URL without overrides, a different system_identifier from the
source, this run's marker in the target, and every selected schema free of rows) precisely so it can
never be pointed at a real database.

## 6. RPO / RTO expectations

- **RPO** is set by Supabase, not by this drill: up to **24 h** with daily backups alone; seconds to
  minutes with the PITR add-on. Check the plan in the dashboard (section 4) — do not assume PITR is on.
- **RTO**: the drill's measured "dump + restore" is the floor for the logical path (seconds at the
  current ~23 MB). A real recovery is dominated by human steps — deciding, provisioning, role
  recreation, rotating connection strings in Vercel/App Runner/GitHub, and verification — budget
  **1–2 hours** for path A to a new project, less for an in-place restore. Re-baseline this after the
  first real quarterly exercise.

## 7. PII handling

Production contains real candidate PII. The drill is designed so that data never leaves the ephemeral
GitHub-hosted runner:

- Rows exist only in the dump file (in a `umask 077` temp dir) and in the job's service container.
  Both are destroyed with the job; the script also deletes the dump on every exit path (EXIT trap).
- No `actions/upload-artifact` or cache step exists; a test fails if one is added
  (`tests/governance/backup-restore-drill.test.ts`).
- The log and step summary carry only table names, row **counts**, sizes and timings. Restore error
  message text is never printed, because Postgres errors quote row values and no redaction survives
  values that contain quotes: only the failing object's TOC entry and a condition name are logged.
- The source role is read-only (no write grants, read-only default transactions) but can read every
  tenant's rows (BYPASSRLS) — see the trade-off in `scripts/backup-drill/create-drill-role.sql`. It
  reads only `public` and `auth`, unless the explicit `pg_read_all_data` fallback of section 2 step 2
  was taken (then every schema). Its credential exists only in the `PROD_BACKUP_DRILL_URL` secret of
  the `prod-backup-drill` environment, released only to jobs running from `main` — **once section 2
  steps 3–5 are done**. Before that, as a repository secret, any workflow in the repository can read
  it; the workflow's triggers do not change that.
- The dump does NOT contain the bearer-token tables' rows (refresh tokens, sessions, one-time tokens,
  MFA AMR claims, OAuth flow state, SAML relay state). It DOES contain `auth.users` (including password
  hashes) and `auth.mfa_factors` (including TOTP secrets): a real restore must carry both, so the drill
  must prove they restore.
- The restore target listens on `127.0.0.1` only, and its bootstrap password is replaced with a random,
  log-masked one before any production row reaches it.
- GitHub (already a processor for this repository) runs the runner; no new subprocessor is added.
