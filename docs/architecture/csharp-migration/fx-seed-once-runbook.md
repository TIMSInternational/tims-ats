# FX Rates One-Off Seed — Runbook

**Who runs this:** Federico, against production, per the standing "I never touch prod" rule
(`PROD-DEPLOY-RUNBOOK-gate-g3.md:16-19`). Claude built and verified the tool below against a local
Testcontainers Postgres (see `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs`)
but has never connected to or run anything against the production database for this task.

## Why

`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` cannot be flipped until `fx_rates` is populated.
The job that normally populates it (`FxRefreshJob`) only runs inside the `Tims.Workers` App Runner
service, which has never been deployed (blocked on BambooHR creds, unrelated timeline). This tool
reuses the exact same business logic (`RefreshFxRatesUseCase`) to populate `fx_rates` once,
manually, without needing that deploy.

**Provider note:** this tool fetches rates from ExchangeRate-API (`open.er-api.com`), not
Frankfurter, which the original design assumed — see
`docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md`. Using it requires (a) UI
attribution to ExchangeRate-API once its rates are shown to users, and (b) registering it as a data
subprocessor (SOC2) — both tracked in `docs/REMAINING-WORK.md`'s Hygiene / recorded debt section.

## Steps

1. **Apply the migration.** Review `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql`,
   then apply it directly against prod:

   ```bash
   psql "$PROD_DATABASE_URL" -f services/Tims.Platform/db/manual/20260723032952_fx_rates.sql
   ```

2. **Convert your prod connection string to Npgsql key/value format**, then run the seed tool. The
   tool's Npgsql-based DbContext does **NOT** accept a `postgresql://` URI — verified live, it
   throws `Format of the initialization string does not conform to specification`. It **DOES**
   accept Npgsql's `Host=...;Port=...;Database=...;Username=...;Password=...` key/value format.
   Convert once, e.g.:

   ```
   postgresql://myuser:mypass@db.example.com:5432/mydb
     →  Host=db.example.com;Port=5432;Database=mydb;Username=myuser;Password=mypass
   ```

   ⚠️ **Use the DB owner/BYPASSRLS connection, not the tenant pooler role.** The migration in step 1
   only grants `app_tenant` SELECT on `fx_rates` — this tool INSERTs, so it needs the same
   owner/BYPASSRLS role's connection you used for `psql` in step 1, not the Supavisor
   tenant-pooling connection string the app itself uses. An `app_tenant`-role connection will fail
   the insert (permission denied) even though the migration applied cleanly.

   ```bash
   # never commit or paste the converted string anywhere
   dotnet run --project services/Tims.Platform/tools/FxSeedOnce -- "Host=...;Port=...;Database=...;Username=...;Password=..."
   ```

3. **Confirm success.** The tool prints `fx-seed-once: pinned N rate(s).` — confirm `N > 0`
   (expect at least 4, for the seed currencies COP/CRC/EUR/MXN). A non-zero exit code or a
   `fx-seed-once: FAILED — ...` line means something needs attention before proceeding (most
   likely: the migration in step 1 wasn't actually applied yet, or the connection string in step 2
   is the tenant pooler role instead of the DB owner/BYPASSRLS role).

4. **Optional sanity check** — eyeball the real values:

   ```bash
   psql "$PROD_DATABASE_URL" -c "SELECT base_currency, quote_currency, rate, as_of FROM fx_rates ORDER BY quote_currency;"
   ```

   Note: `as_of` reflects ExchangeRate-API's own UTC publication timestamp, not your local clock —
   depending on what time you run this and your local timezone, `as_of` can legitimately show
   tomorrow's date. That's expected, not a bug.

5. **Only after this is confirmed populated**, proceed to flipping
   `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` (separate task/session step).

## Re-running

The underlying upsert is idempotent (`ON CONFLICT (base_currency, quote_currency, as_of) DO
UPDATE`) — safe to re-run this tool any number of times, e.g. periodically to keep rates fresh
until `Tims.Workers` is eventually deployed and takes over on its own Quartz schedule.
