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

## Correction (2026-07-29, revised)

The original write-up overstated the gap, and a first correction attempt (below, struck through in
spirit) was ALSO wrong: Frankfurter's **v2** API does return real rates for COP/CRC, via both
`GET /v2/rate/{base}/{quote}` and a genuine batch endpoint, `GET /v2/rates?base=X&quotes=Y,Z,...`
— confirmed live: `curl "https://api.frankfurter.dev/v2/rates?base=USD&quotes=COP,CRC,EUR,MXN"`
returns all four currencies in one 200 response. So "ExchangeRate-API was kept for single-batch-call
simplicity" (the first correction's claim) is not a valid distinguishing reason either — Frankfurter
v2 has its own batch endpoint.

**The real, final reason ExchangeRate-API was kept:** Frankfurter's own `/v2/currencies` catalog
(165 entries) does NOT list COP or CRC, even though `/v2/rate(s)` return real, distinctly-dated data
for both. This is an inconsistency in Frankfurter's own API — its rate endpoints serve currencies its
own currency catalog doesn't document. ExchangeRate-API's response explicitly and consistently
includes both COP and CRC among its ~166 currencies, with no such catalog/endpoint mismatch. Given
this is production financial data, the documented-and-consistent provider was chosen over the one
with an unexplained gap between what its endpoints serve and what its own catalog claims to support
— accepting ExchangeRate-API's attribution + subprocessor-registration overhead (tracked in
`docs/REMAINING-WORK.md`) as the cost of that reliability guarantee.

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
