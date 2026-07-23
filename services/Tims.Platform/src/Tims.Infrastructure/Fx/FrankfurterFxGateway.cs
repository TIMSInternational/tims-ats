using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Tims.Application.Fx;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// <see cref="IFxRateGateway"/> for frankfurter (ECB), on a TYPED HttpClient whose message pipeline carries the
/// Polly-v8 resilience handler wired in <see cref="FxServiceCollectionExtensions"/> (total timeout →
/// retry+backoff+jitter on 429/5xx → circuit breaker). frankfurter is KEYLESS — there is NO Authorization header,
/// NO secret. The ONLY egress is currency codes (no PII); register frankfurter.dev in the SOC2 subprocessor
/// register. The ONLY frankfurter surface in the codebase.
/// </summary>
public sealed class FrankfurterFxGateway(HttpClient httpClient) : IFxRateGateway
{
    private readonly HttpClient _httpClient = httpClient;

    public async Task<FxGatewayRates> FetchLatestAsync(
        string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseCurrency);
        ArgumentNullException.ThrowIfNull(quoteCurrencies);
        if (quoteCurrencies.Count == 0)
        {
            throw new ArgumentException("At least one quote currency is required.", nameof(quoteCurrencies));
        }

        // latest?base=USD&symbols=EUR,COP,… — relative to the typed client's pinned BaseAddress.
        var symbols = string.Join(',', quoteCurrencies);
        var requestUri = new Uri(
            $"latest?base={Uri.EscapeDataString(baseCurrency)}&symbols={Uri.EscapeDataString(symbols)}",
            UriKind.Relative);

        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        // SendAsync runs the typed client's resilience handler; a transient 429/5xx is retried and, on
        // persistent failure, the circuit opens (BrokenCircuitException) — both surface to the caller (the job).
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
        var root = document.RootElement;

        var asOf = ParseDate(root);
        var rates = new Dictionary<string, double>(StringComparer.Ordinal);
        if (root.TryGetProperty("rates", out var ratesElement) && ratesElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var pair in ratesElement.EnumerateObject())
            {
                if (pair.Value.ValueKind == JsonValueKind.Number && pair.Value.TryGetDouble(out var rate))
                {
                    rates[pair.Name] = rate;
                }
            }
        }

        return new FxGatewayRates(baseCurrency, asOf, rates);
    }

    // frankfurter's `date` is the ECB effective date (yyyy-MM-dd). Absent/unparseable → today's UTC date.
    private static DateOnly ParseDate(JsonElement root) =>
        root.TryGetProperty("date", out var dateElement)
        && dateElement.ValueKind == JsonValueKind.String
        && DateOnly.TryParse(dateElement.GetString(), CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : DateOnly.FromDateTime(DateTime.UtcNow);
}
