# Backup & Restore Runbook

> Owner: NexaDev LLC · Applies to: production Supabase Postgres 17.6 (`public` + `auth`)
> Automation: `.github/workflows/backup-restore-drill.yml` → `scripts/backup-drill/run-drill.sh`

## 1. What the weekly drill proves, and what it does not

**It proves** that a logical dump of production:

- can be taken at one consistent snapshot (`pg_export_snapshot()` + `pg_dump --snapshot`);
- restores cleanly into an empty Postgres of the same version (`supabase/postgres:17.6.1.178`), with
  **no restore errors** (the allow-list is empty; any error fails the drill);
- is **complete**: the exact `count(*)` of every table in `public` and `auth`, taken inside the dump's
  snapshot, equals the restored count; and the schema inventory of both schemas (tables, columns,
  defaults, indexes, constraints, RLS enabled/forced flags, policies with their roles and
  expressions, triggers including their enabled state, and full function definitions — body, SECURITY DEFINER, SET clauses, volatility) is identical;
- and it measures the logical-restore RTO floor (dump + restore seconds) and the dump size.

**It does NOT prove:**

| Not covered                                  | Why / where it is covered instead                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase's managed daily backups / PITR work | Only Supabase can restore those. **Quarterly manual step**, section 4.                                                                                                                                   |
| That a backup EXISTS                         | The drill keeps nothing: its dump is deleted at the end of the job. It is a test of the restore path, not a backup. The backups are Supabase's (section 4).                                              |
| `storage`, `vault`, `realtime`, `graphql`    | `storage`: no app code uses Supabase Storage (CVs live in S3). `vault`: secrets are encrypted with a per-project key and would not decrypt in another database. The rest are platform-managed.           |
| `supabase_migrations` history ledger         | Excluded to keep the first version minimal; add it to `DRILL_SCHEMAS` if a restore should carry it.                                                                                                      |
| Role attributes, passwords and memberships   | Roles are cluster-level and never in a `pg_dump`. The drill creates missing role _names_ as bare `NOLOGIN` roles so policies and GRANTs restore. A real restore must recreate them properly (section 5). |
| Sequence values                              | Not compared: sequences are non-transactional, so a busy sequence could differ between the count and the dump without anything being wrong. `pg_dump` does include them.                                 |
| GRANTs / ownership                           | GRANTs are restored (and would fail the drill if a grantee were missing) but not compared. Ownership is dropped (`--no-owner`).                                                                          |

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

   The file is idempotent and ends with assertions (not superuser, BYPASSRLS, only `pg_read_all_data`,
   zero writable tables, connection limit 2); it rolls back if any fails.

3. Store the secret. Use the **session pooler** host on port **5432** (GitHub runners have no IPv6, so
   the direct `db.<ref>.supabase.co` host is unreachable; the transaction pooler on 6543 cannot hold a
   snapshot). Do **not** add `sslmode` — the drill refuses a URL that carries one and enforces
   `verify-full` against the committed Supabase root CA itself.

   ```bash
   gh secret set PROD_BACKUP_DRILL_URL --repo TIMSInternational/tims-ats
   ```

   Paste `postgresql://backup_drill_reader.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres`
   at the prompt, so the URL never lands in shell history.

4. Trigger the first run and watch it:

   ```bash
   gh workflow run backup-restore-drill.yml --repo TIMSInternational/tims-ats
   ```

   ```bash
   gh run watch --repo TIMSInternational/tims-ats
   ```

5. Record the role and the secret in the access register (#40).

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
- **exit 1, restore errors**: production may carry objects the synthetic database did not (e.g. a
  publication membership or a function referencing another schema). Triage each error; if it is
  genuinely harmless, add a narrow pattern to `RESTORE_ALLOW_LIST` in `run-drill.sh` with a comment.
- **exit 1, inventory differs**: read the diff; it names the exact object.

## 3. Reading a result

| Exit | Step summary headline            | Meaning                                                                                  |
| ---- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| 0    | ✅ Backup-restore drill VERIFIED | Restorable and complete at the snapshot. RTO and dump size in the table.                 |
| 1    | ❌ … FOUND N PROBLEM(S)          | The backup path is broken. Treat as an incident-severity finding; the log names objects. |
| 2    | ⚠️ … DID NOT RUN                 | **Not a pass.** Missing secret, unreachable DB, lost BYPASSRLS, wrong DB, failed dump.   |

Exit 1 and exit 2 both fail the job (same contract as the nightly DB controls, #124 / #38).

## 4. Quarterly: verify Supabase's managed backups (manual)

The drill cannot see Supabase's own backups. Once a quarter:

1. Supabase dashboard → the production project → **Database → Backups**. Confirm the most recent
   daily backup is from the last 24 hours, note the retention window, and whether PITR is enabled.
2. If the plan offers **restore to a new project**, restore the latest backup into a new, temporary
   project. Never test-restore over production.
3. Point the drill at the restored project to verify it: run `run-drill.sh` locally with
   `DRILL_SOURCE_URL` set to the temporary project's session-pooler URL for a `backup_drill_reader`
   created there, and a local `supabase/postgres:17.6.1.178` container as the target. Compare the
   per-table counts against the latest weekly drill summary.
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
4. Verify before reopening: run the nightly controls (checks 14, 16, 17) against the restored database
   and run this drill against it (section 4 step 3).

### B. Fallback — logical dump (when a managed backup is unavailable)

Only possible while the source database is still readable (e.g. migrating off a degraded project).
Use a PostgreSQL 17 client:

1. Create the new Supabase project (same region, Postgres 17), then recreate the project roles with
   their real attributes (not the drill's `NOLOGIN` stand-ins).
2. Dump, exactly as the drill does, but to an encrypted local disk that you delete afterwards:
   `pg_dump --format=custom --no-owner -n public -n auth`.
3. Restore `public` as `postgres`: `pg_restore --no-owner -n public -d "$NEW_DB_URL" dump`.
4. Restore `auth` **data only** into the new project's GoTrue-managed tables:
   `pg_restore --data-only -n auth --disable-triggers -d "$NEW_DB_URL" dump`. First confirm both projects
   run the same GoTrue version (column sets must match); if not, stop and open a Supabase support ticket.
5. Verify counts and inventory (run the drill against the new project), then cut consumers over as in
   A.3–A.4.

**Never** run `pg_restore --clean` against the existing production database. The drill's target guard
(loopback host and empty `public` schema) exists precisely so its destructive preparation cannot be
pointed at production.

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
  tenant's rows (BYPASSRLS) — see the trade-off in `scripts/backup-drill/create-drill-role.sql`. Its
  credential exists only in the `PROD_BACKUP_DRILL_URL` secret and is scoped to a schedule/dispatch-only
  workflow that pull requests cannot trigger.
- GitHub (already a processor for this repository) runs the runner; no new subprocessor is added.
