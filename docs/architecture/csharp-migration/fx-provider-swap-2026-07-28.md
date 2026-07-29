# FX Rate Provider Swap: Frankfurter → ExchangeRate-API (2026-07-28)

## What happened

While building the `FxSeedOnce` one-off tool to populate `fx_rates` (needed to flip
`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`), its integration test made the first-ever real call
to the live Frankfurter API with COP and CRC. The gateway called Frankfurter's **v1** batch endpoint
(`v1/latest?base=X&symbols=Y,Z`) — its ECB-sourced list of ~30 major/regional currencies genuinely
does not include COP or CRC, confirmed via `curl https://api.frankfurter.dev/v1/currencies`. Per
`RefreshFxRatesUseCase.cs`'s own original comment, COP/CRC are "the live TIMS/INVU currencies" —
the actual currencies this platform's real customer orgs use. No existing test had ever exercised
the real gateway with these currency codes before (existing tests used synthetic hand-supplied
rates).

## Correction (2026-07-29)

The original write-up above overstated the gap: Frankfurter's **v2** API, via its per-pair endpoint
(`GET /v2/rate/{base}/{quote}`), DOES return real rates for both COP and CRC — confirmed live:
`curl https://api.frankfurter.dev/v2/rate/USD/COP` returns
`{"date":"...","base":"USD","quote":"COP","rate":3203.02}`. The gap is in Frankfurter's v1 batch
endpoint (the one the original gateway called), not in Frankfurter as a provider.

**The decision to keep ExchangeRate-API still stands**, but the honest reason is narrower than
originally stated: ExchangeRate-API returns ALL needed currencies (COP/CRC/EUR/MXN) in ONE batch
HTTP call, whereas Frankfurter v2 only supports per-pair lookups — refreshing the same four
currencies against v2 would need 4 separate calls instead of 1. ExchangeRate-API was kept for
single-batch-call simplicity, not because Frankfurter is incapable of resolving COP/CRC.

## What changed

Replaced the `IFxRateGateway` adapter: `FrankfurterFxGateway` → `ExchangeRateApiGateway`, backed by
ExchangeRate-API's open/free tier (`open.er-api.com`) — confirmed via live API call to cover both
COP and CRC, plus 166 currencies total. Same posture as Frankfurter: keyless, free, commercial use
permitted. Only the concrete adapter, `FxOptions`, and the DI registration changed —
`RefreshFxRatesUseCase`'s orchestration logic, `FxRateWriteRepository`, `FxRateDbContext`, the
migration, and the `FxSeedOnce` tool were all untouched (they depend only on the `IFxRateGateway`
interface).

## Why this provider

See the comparison table in `docs/superpowers/specs/2026-07-28-fx-provider-swap-design.md`. In
short: Open Exchange Rates also covers COP/CRC but requires a paid plan + API key (new secret, new
recurring cost); exchangerate.host no longer has a free/keyless tier; official central bank APIs
are the most authoritative for these two specific currencies but would require two separate
country-specific integrations plus a second source for other currencies. ExchangeRate-API's open
tier solves the actual problem with the least disruption to the existing keyless, free setup.

## Verification

- New/updated resilience tests: `ExchangeRateApiGatewayResilienceTests.cs` (stub-based, no live
  call — retry/circuit-breaker/filtering/error-handling).
- Live re-verification: `FxSeedRunnerTests.cs`'s assertion restored to `>= 4` and re-run against
  the real API — all 4 seed currencies (COP/CRC/EUR/MXN) now populate for real.
