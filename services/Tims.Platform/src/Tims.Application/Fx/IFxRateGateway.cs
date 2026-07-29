namespace Tims.Application.Fx;

/// <summary>
/// The outbound port to the external FX-rate provider (ExchangeRate-API, KEYLESS — see
/// docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md; originally Frankfurter/ECB v1, whose
/// batch endpoint didn't cover COP/CRC — v2's per-pair endpoint does, but ExchangeRate-API's single batch
/// call was kept for simplicity). The ONLY egress surface — implemented by the typed
/// <c>ExchangeRateApiGateway</c> (HttpClient + Polly resilience). Used ONLY by the daily refresh job to PIN
/// rates into <c>fx_rates</c>; the FX-derived reads read the pins, never this gateway. Fake-tested with a stub
/// HttpMessageHandler — a live rate is NEVER golden-parity fixtured.
/// </summary>
public interface IFxRateGateway
{
    /// <summary>
    /// Fetch the latest base→quote rates for <paramref name="quoteCurrencies"/> against
    /// <paramref name="baseCurrency"/>. Returns the provider's effective date + the rates. Transient failures
    /// are retried by the Polly pipeline; a persistent failure throws (the job's ResilientJobRunner records +
    /// alerts, then the next tick retries).
    /// </summary>
    Task<FxGatewayRates> FetchLatestAsync(
        string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken);
}
