namespace Tims.Application.Fx;

/// <summary>
/// The outbound port to the external FX-rate provider (frankfurter / ECB, KEYLESS). The ONLY frankfurter
/// surface — implemented by the typed <c>FrankfurterFxGateway</c> (HttpClient + Polly resilience). Used ONLY by
/// the daily refresh job to PIN rates into <c>fx_rates</c>; the FX-derived reads read the pins, never this
/// gateway. Fake-tested with a stub HttpMessageHandler — a live rate is NEVER golden-parity fixtured.
/// </summary>
public interface IFxRateGateway
{
    /// <summary>
    /// Fetch the latest base→quote rates for <paramref name="quoteCurrencies"/> against
    /// <paramref name="baseCurrency"/> (frankfurter <c>latest?base=…&amp;symbols=…</c>). Returns the ECB
    /// effective date + the rates. Transient failures are retried by the Polly pipeline; a persistent failure
    /// throws (the job's ResilientJobRunner records + alerts, then the next tick retries).
    /// </summary>
    Task<FxGatewayRates> FetchLatestAsync(
        string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken);
}
