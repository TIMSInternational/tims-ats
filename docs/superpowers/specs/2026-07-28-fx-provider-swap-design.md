# FX Rate Provider Swap (Frankfurter → ExchangeRate-API) — Design

## Problem

The FX-rates seed tool built this session (`FxSeedOnce`) exists to unblock the compensation
FX-dependent reads (`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`). While building and testing it,
its integration test made the first-ever REAL call to the live Frankfurter API with COP/CRC — and
discovered that **Frankfurter (ECB) does not support COP (Colombian Peso) or CRC (Costa Rican
Colón) at all**. Its currency set is a fixed list of ~30 major/regional currencies; COP and CRC are
not on it, at any date, ever (independently verified: `curl
https://api.frankfurter.dev/v1/currencies`).

Per `RefreshFxRatesUseCase.cs`'s own code comment, COP and CRC are "the live TIMS/INVU currencies"
— the actual currencies this platform's real customer orgs use. This means the entire
FX-dependent-reads feature (band distribution, total comp breakdown, dashboard KPIs) would never
actually work for the customers it matters for, regardless of how many times `FxRefreshJob` (or
the seed tool) runs — only EUR/MXN would ever populate.

## Goal

Replace the Frankfurter adapter with one that actually covers COP and CRC, changing only the
concrete gateway implementation behind the existing `IFxRateGateway` port — every other component
(`RefreshFxRatesUseCase`, `FxRateWriteRepository`, `FxRateDbContext`, the `FxSeedOnce` tool) stays
untouched, since they depend only on the interface.

## Provider Selection

Verified directly (not from documentation alone):

| Provider                                           | COP/CRC?                                                   | Auth                        | Cost | Notes                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------- | --------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| Frankfurter (current)                              | **No** — confirmed via live API                            | Keyless                     | Free | ~30 ECB majors only                                                                                          |
| **ExchangeRate-API open tier (`open.er-api.com`)** | **Yes** — confirmed via live API (COP=3215.61, CRC=455.19) | Keyless                     | Free | 166 currencies, daily updates, commercial use explicitly permitted (attribution required, no redistribution) |
| Open Exchange Rates                                | Yes (per docs)                                             | API key                     | Paid | More precision/currencies than needed; adds a secret + recurring cost                                        |
| exchangerate.host                                  | N/A                                                        | API key (changed from free) | Paid | Ruled out — no longer keyless                                                                                |
| Central bank APIs (Colombia/Costa Rica)            | Yes, most authoritative                                    | Varies                      | Free | Two separate country-specific integrations; still needs a second source for EUR/MXN/other                    |

**Chosen: ExchangeRate-API's open/free tier.** Same "keyless, free, simple" shape as the current
Frankfurter setup — closest fit to a drop-in replacement, no new secrets, no new recurring cost,
and it solves the actual problem.

## Architecture

`IFxRateGateway` (in `Tims.Application`) is unchanged — it's already provider-agnostic in
signature. Only the concrete `Tims.Infrastructure` adapter, its options, its DI registration, and
its own dedicated test change.

## Components

- **`ExchangeRateApiGateway.cs`** (replaces `FrankfurterFxGateway.cs`, same namespace
  `Tims.Infrastructure.Fx`) — implements `IFxRateGateway.FetchLatestAsync`:
  - Builds `GET {baseAddress}v6/latest/{baseCurrency}` (`open.er-api.com`'s base currency is a
    **path segment**, unlike Frankfurter's `?base=` query param).
  - Checks the response's `result` field equals `"success"` before trusting anything else — this
    API can return HTTP 200 with an app-level error (e.g. unsupported base currency) — throws
    `InvalidOperationException` with the raw `result` value otherwise, never silently proceeds.
  - Parses `time_last_update_unix` (Unix epoch seconds) → `DateOnly` via
    `DateTimeOffset.FromUnixTimeSeconds(...).UtcDateTime`.
  - **Filters `rates` to only the requested `quoteCurrencies`** — unlike Frankfurter, this
    provider has no server-side `symbols` filter and always returns all ~166 currencies; the
    gateway keeps only the caller-requested keys before returning `FxGatewayRates`, so
    `RefreshFxRatesUseCase`'s downstream logic (positive/finite filtering, upsert) is unaffected by
    receiving 166 rows instead of 4.
- **`FxOptions.cs`** — `FrankfurterBaseUrl` → `ExchangeRateApiBaseUrl`, default value
  `https://open.er-api.com/`. `ResolvedFrankfurterBaseUrl()` → `ResolvedExchangeRateApiBaseUrl()`.
  Doc comments updated (no longer claim "frankfurter (ECB)" specifically); all resilience knobs
  (`TotalTimeoutSeconds`, `MaxRetryAttempts`, etc.) are untouched — generic HTTP failure handling,
  not provider-specific.
- **`FxServiceCollectionExtensions.cs`** — `AddHttpClient<IFxRateGateway, FrankfurterFxGateway>` →
  `AddHttpClient<IFxRateGateway, ExchangeRateApiGateway>`; `FrankfurterPipelineName` constant
  renamed to `ExchangeRateApiPipelineName` (internal Polly pipeline name string, no external
  effect). Structurally identical registration otherwise.
- **`RefreshFxRatesUseCase.cs`** — `Source` constant: `"frankfurter"` → `"exchangerate-api"` (the
  value written into every `fx_rates.source` column — accurate data provenance for what is
  effectively a compliance-adjacent audit field).
- **`FxRateEntity.cs`** — default `Source` property value updated to match, for consistency.
- **Doc-comment accuracy pass (no behavior change)**: `IFxRateGateway.cs`, `PlatformOptions.cs`,
  `Tims.Workers/Program.cs` — comments naming "frankfurter"/"ECB" specifically, updated to name the
  real provider.
- **Untouched** (depend only on `IFxRateGateway`, never the concrete class): `RefreshFxRatesUseCase`'s
  actual orchestration logic (only the `Source` literal changes), `FxRateWriteRepository`,
  `FxRateDbContext`, `FxSeedRunner` (Task 1's composition root — needs zero code changes; it will
  automatically use the new gateway once `AddFxRateGateway()` is updated).
- **New doc**, `docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md` — explains the
  COP/CRC gap and the swap decision, with a one-line pointer added to
  `phase-5-slice-11c-fx-gateway-read.md` and `PROD-DEPLOY-RUNBOOK-gate-g3.md`, matching this repo's
  existing "dated UPDATE note" convention (seen already in `PROD-DEPLOY-RUNBOOK-gate-g3.md`'s own
  header) rather than rewriting the original slice docs' history.

## Testing

- **Rename + rewrite** `FrankfurterFxGatewayResilienceTests.cs` →
  `ExchangeRateApiGatewayResilienceTests.cs`: same two existing scenarios (transient 429/500 retry
  then success; persistent 5xx opens the circuit) with the stub response body updated to the real
  `{"result":"success","base_code":"USD","time_last_update_unix":...,"rates":{...}}` shape, and the
  `AddHttpClient<IFxRateGateway, ...>` registration line updated to `ExchangeRateApiGateway`.
- **One new test**: stub returns MORE currencies than requested (proving the client-side filter
  behavior that Frankfurter never needed, since it filtered server-side via `symbols=`).
- **One new test**: stub returns `"result":"error"` — asserts the gateway throws rather than
  returning an empty/garbage `FxGatewayRates`.
- **`FxSeedRunnerTests.cs`** (from Task 1, already committed) — assertion restored from the
  interim `>= 2` back to the original `>= 4`, now that the real provider genuinely covers all four
  seed currencies. This re-run is a real, live proof that COP/CRC now populate for real.
- Full Fx-suite regression run (`dotnet test --filter Fx`) + full solution build (0 warnings, repo
  has `TreatWarningsAsErrors=true`).
- Grep sweep for any remaining functional (non-doc, non-historical-doc) "frankfurter"/"Frankfurter"
  reference after the change, to confirm nothing was missed.

## Error Handling

- Non-`"success"` `result` → `InvalidOperationException`, never silently treated as valid data.
- HTTP-level failures (429/5xx/timeouts) → unchanged Polly resilience pipeline (retry with
  backoff+jitter, then circuit breaker) — no new logic needed, this provider's failure modes are
  the same HTTP transient-failure category Frankfurter already handled.
- A requested currency simply absent from the response (shouldn't happen given 166-currency
  coverage, but defensively) → same as today, `RefreshFxRatesUseCase` only pins currencies actually
  present and positive/finite in the returned `Rates` dict.

## Out of Scope

- Any change to `RefreshFxRatesUseCase`'s orchestration logic beyond the `Source` literal.
- Any change to `FxRateWriteRepository`, `FxRateDbContext`, the migration, or `FxSeedOnce`'s own
  code (Task 1 already committed — this swap requires zero changes there).
- Rewriting the history of `phase-5-slice-11c-fx-gateway-read.md` or
  `PROD-DEPLOY-RUNBOOK-gate-g3.md` — only a short pointer note is added to each.
- Registering the new subprocessor in an actual external SOC2/compliance tracking system — that's
  an org-level action for Federico, outside this codebase (there is no in-repo subprocessor
  register file to edit; confirmed via grep).
- Resuming the original FX-seed-once Task 2 (entrypoint/migration/runbook) — that resumes
  immediately after this swap plan is complete and verified.
