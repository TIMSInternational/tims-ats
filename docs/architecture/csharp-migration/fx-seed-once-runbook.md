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

## Steps

1. **Apply the migration.** Review `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql`,
   then apply it directly against prod:

   ```bash
   psql "$PROD_DATABASE_URL" -f services/Tims.Platform/db/manual/20260723032952_fx_rates.sql
   ```

2. **Run the seed tool once**, passing your prod connection string as the single argument (never
   commit or paste this string anywhere):

   ```bash
   dotnet run --project services/Tims.Platform/tools/FxSeedOnce -- "$PROD_DATABASE_URL"
   ```

3. **Confirm success.** The tool prints `fx-seed-once: pinned N rate(s).` — confirm `N > 0`
   (expect at least 4, for the seed currencies COP/CRC/EUR/MXN). A non-zero exit code or a
   `fx-seed-once: FAILED — ...` line means something needs attention before proceeding (most
   likely: the migration in step 1 wasn't actually applied yet).

4. **Optional sanity check** — eyeball the real values:

   ```bash
   psql "$PROD_DATABASE_URL" -c "SELECT base_currency, quote_currency, rate, as_of FROM fx_rates ORDER BY quote_currency;"
   ```

5. **Only after this is confirmed populated**, proceed to flipping
   `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` (separate task/session step).

## Re-running

The underlying upsert is idempotent (`ON CONFLICT (base_currency, quote_currency, as_of) DO
UPDATE`) — safe to re-run this tool any number of times, e.g. periodically to keep rates fresh
until `Tims.Workers` is eventually deployed and takes over on its own Quartz schedule.
