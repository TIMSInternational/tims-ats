using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tims.Application.Fx;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// <see cref="IFxRateGateway"/> for ExchangeRate-API's open/free tier (open.er-api.com), on a TYPED HttpClient
/// whose message pipeline carries the Polly-v8 resilience handler wired in
/// <see cref="FxServiceCollectionExtensions"/> (total timeout → retry+backoff+jitter on 429/5xx → circuit
/// breaker). Keyless — NO Authorization header, NO secret. The ONLY egress is currency codes (no PII).
/// Replaces the original Frankfurter adapter (Slice 11c): the original gateway called Frankfurter's v1
/// (ECB) batch endpoint, whose fixed ~30-currency list does not include COP or CRC — the actual
/// currencies this platform's real customer orgs use. Frankfurter's v2 API DOES support both, via a real
/// batch endpoint too; ExchangeRate-API was kept instead because Frankfurter's own `/v2/currencies`
/// catalog doesn't list COP/CRC even though its rate endpoints serve real data for both — an
/// unexplained catalog/endpoint gap that ExchangeRate-API's consistent ~166-currency catalog doesn't
/// have. See docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md (correction dated
/// 2026-07-29).
/// </summary>
public sealed class ExchangeRateApiGateway(HttpClient httpClient, ILogger<ExchangeRateApiGateway> logger) : IFxRateGateway
{
    private readonly HttpClient _httpClient = httpClient;
    private readonly ILogger<ExchangeRateApiGateway> _logger = logger;

    public async Task<FxGatewayRates> FetchLatestAsync(
        string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseCurrency);
        ArgumentNullException.ThrowIfNull(quoteCurrencies);
        if (quoteCurrencies.Count == 0)
        {
            throw new ArgumentException("At least one quote currency is required.", nameof(quoteCurrencies));
        }

        // v6/latest/USD — base currency is a PATH segment (unlike Frankfurter's ?base= query param), relative
        // to the typed client's pinned BaseAddress. No server-side symbols filter on the open tier — every
        // response carries all ~166 currencies; this gateway filters down to quoteCurrencies below.
        var requestUri = new Uri($"v6/latest/{Uri.EscapeDataString(baseCurrency)}", UriKind.Relative);

        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        // SendAsync runs the typed client's resilience handler; a transient 429/5xx is retried and, on
        // persistent failure, the circuit opens (BrokenCircuitException) — both surface to the caller (the job).
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
        var root = document.RootElement;

        // This API can return HTTP 200 with an app-level error (e.g. an unsupported base currency) — never
        // trust the body without checking "result" first.
        var result = root.TryGetProperty("result", out var resultElement) ? resultElement.GetString() : null;
        if (!string.Equals(result, "success", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"ExchangeRate-API returned result=\"{result ?? "(missing)"}\".");
        }

        var asOf = ParseDate(root);
        var quoteSet = new HashSet<string>(quoteCurrencies, StringComparer.Ordinal);
        var rates = new Dictionary<string, double>(StringComparer.Ordinal);
        if (root.TryGetProperty("rates", out var ratesElement) && ratesElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var pair in ratesElement.EnumerateObject())
            {
                if (quoteSet.Contains(pair.Name)
                    && pair.Value.ValueKind == JsonValueKind.Number
                    && pair.Value.TryGetDouble(out var rate))
                {
                    rates[pair.Name] = rate;
                }
            }
        }

        // Log any requested currency the response didn't carry — silent partial coverage is exactly the
        // failure mode that let the original v1-based gap under-pin COP/CRC unnoticed. This gateway still
        // returns whatever it did find (fail-soft, per RefreshFxRatesUseCase's cold-start contract); the log
        // is what gives that silent gap visibility.
        if (rates.Count < quoteSet.Count)
        {
            var missing = quoteSet.Where(quote => !rates.ContainsKey(quote)).ToArray();
            _logger.LogWarning(
                "ExchangeRate-API response for base {BaseCurrency} is missing {MissingCount} requested " +
                "currency(ies): {MissingCurrencies}. Returning the {FoundCount} that were found.",
                baseCurrency, missing.Length, string.Join(", ", missing), rates.Count);
        }

        return new FxGatewayRates(baseCurrency, asOf, rates);
    }

    // time_last_update_unix is Unix epoch seconds (UTC). Absent/unparseable → today's UTC date.
    private static DateOnly ParseDate(JsonElement root) =>
        root.TryGetProperty("time_last_update_unix", out var unixElement)
        && unixElement.ValueKind == JsonValueKind.Number
        && unixElement.TryGetInt64(out var unixSeconds)
            ? DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(unixSeconds).UtcDateTime)
            : DateOnly.FromDateTime(DateTime.UtcNow);
}
