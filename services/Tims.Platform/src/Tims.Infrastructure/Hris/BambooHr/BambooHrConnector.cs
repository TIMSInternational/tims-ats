using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Tims.Application.Hris;
using Tims.Domain.Hris;

namespace Tims.Infrastructure.Hris.BambooHr;

/// <summary>
/// <see cref="IHrisConnector"/> for BambooHR, on a TYPED HttpClient whose message pipeline carries the
/// Polly-v8 resilience handler wired in <see cref="HrisConnectorServiceCollectionExtensions"/>
/// (total timeout → retry+backoff+jitter on 429/5xx → circuit breaker). It authenticates with HTTP
/// Basic auth — BambooHR uses the API key as the username and any string as the password.
///
/// SECRET HYGIENE (hard requirement): the API key is fetched from the <see cref="IConnectorSecretStore"/>
/// per request and placed ONLY into the request's Authorization header. It is never logged, serialized,
/// stored on the shared client, or echoed anywhere.
///
/// MULTI-TENANT ISOLATION: the API key AND the base URL come from the PER-CONNECTOR
/// <see cref="HrisConnectorAuthContext"/> (its own secret_ref + subdomain) passed on every call — never a
/// global/shared credential or URL — so two org connectors can never pull the same source tenant.
/// </summary>
public sealed class BambooHrConnector : IHrisConnector
{
    private const string DirectoryPath = "employees/directory";

    private readonly HttpClient _httpClient;
    private readonly IConnectorSecretStore _secretStore;
    private readonly HrisOptions _options;

    public BambooHrConnector(HttpClient httpClient, IConnectorSecretStore secretStore, IOptions<HrisOptions> options)
    {
        _httpClient = httpClient;
        _secretStore = secretStore;
        _options = options.Value;
    }

    public async Task<HrisDirectoryPage> FetchDirectoryAsync(
        HrisConnectorAuthContext auth, HrisFetchCursor? cursor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(auth);

        // BambooHR's directory is a single page. A non-null cursor means the caller already consumed
        // it, so signal exhaustion rather than re-pulling (defends a paging loop against a mishandled cursor).
        if (cursor is not null)
        {
            return new HrisDirectoryPage([], Next: null);
        }

        using var document = await GetJsonAsync(auth, DirectoryPath, cancellationToken).ConfigureAwait(false);

        var employees = new List<HrisSourceEmployee>();
        if (document.RootElement.TryGetProperty("employees", out var employeesElement)
            && employeesElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var employee in employeesElement.EnumerateArray())
            {
                employees.Add(ParseEmployee(employee));
            }
        }

        // Next is always null: BambooHR yields the whole directory in one response.
        return new HrisDirectoryPage(employees, Next: null);
    }

    public async Task<HrisSourceEmployee> FetchEmployeeAsync(
        HrisConnectorAuthContext auth, string externalId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(auth);
        ArgumentException.ThrowIfNullOrWhiteSpace(externalId);

        // `fields=all` returns the full flat field set for the employee.
        var path = $"employees/{Uri.EscapeDataString(externalId)}?fields=all";
        using var document = await GetJsonAsync(auth, path, cancellationToken).ConfigureAwait(false);
        return ParseEmployee(document.RootElement, fallbackExternalId: externalId);
    }

    /// <summary>Sends an authenticated GET through the resilient pipeline and parses the JSON body.</summary>
    private async Task<JsonDocument> GetJsonAsync(
        HrisConnectorAuthContext auth, string relativePath, CancellationToken cancellationToken)
    {
        // Absolute URI built from the CONNECTOR'S OWN subdomain (never the client's global BaseAddress).
        var requestUri = new Uri(new Uri(_options.ResolveBambooHrBaseUrl(auth.Subdomain)), relativePath);
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Authorization = await BuildBasicAuthAsync(auth.SecretRef, cancellationToken).ConfigureAwait(false);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        // SendAsync runs the typed client's resilience handler; a transient 429/5xx is retried and,
        // on persistent failure, the circuit opens (BrokenCircuitException) — both surface to the caller.
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        return await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Builds the Basic-auth header from the connector's OWN <paramref name="secretRef"/>. The plaintext key
    /// lives only in the local <c>raw</c>/<c>encoded</c> here and in the returned header — never logged or persisted.
    /// </summary>
    private async Task<AuthenticationHeaderValue> BuildBasicAuthAsync(string secretRef, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(secretRef);
        var secret = await _secretStore.GetAsync(secretRef, cancellationToken).ConfigureAwait(false);
        // BambooHR: API key as username, any non-empty password ("x" by convention).
        var raw = $"{secret.Reveal()}:x";
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(raw));
        return new AuthenticationHeaderValue("Basic", encoded);
    }

    /// <summary>
    /// Turns a BambooHR employee JSON object into a provider-neutral <see cref="HrisSourceEmployee"/>:
    /// the <c>id</c> becomes <see cref="HrisSourceEmployee.ExternalId"/> and every other property becomes
    /// a source field (string values as-is, JSON null as null).
    /// </summary>
    private static HrisSourceEmployee ParseEmployee(JsonElement employee, string? fallbackExternalId = null)
    {
        var externalId = fallbackExternalId ?? string.Empty;
        var fields = new Dictionary<string, string?>(StringComparer.Ordinal);

        if (employee.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in employee.EnumerateObject())
            {
                if (string.Equals(property.Name, "id", StringComparison.Ordinal))
                {
                    externalId = ValueOf(property.Value) ?? externalId;
                    continue;
                }

                fields[property.Name] = ValueOf(property.Value);
            }
        }

        return new HrisSourceEmployee(externalId, fields);
    }

    private static string? ValueOf(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Undefined => null,
        _ => element.ToString(),
    };
}
