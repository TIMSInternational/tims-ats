namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// <c>AssessmentProviders:*</c> (env <c>AssessmentProviders__BaseUrl</c> etc.): the ATS's ONE OAuth client for the TIMS
/// Assessments API v1 and the webhook signing secret(s). Secrets come from Secrets Manager via App Runner env, never
/// from appsettings. A missing or placeholder value never fails startup (the surface is dark by default); it makes
/// <see cref="IsConfigured"/> false, and every call answers <c>provider_unconfigured</c> / every webhook is refused.
/// </summary>
public sealed class AssessmentProviderOptions
{
    public const string SectionName = "AssessmentProviders";

    /// <summary>The value terraform seeds into every secret until it is set out of band. It is NOT a secret.</summary>
    public const string TerraformPlaceholder = "REPLACE_ME_OUT_OF_BAND";

    public const string DefaultScopes = "catalog:read assignments:write subjects:write results:read";

    /// <summary>
    /// The API base URL: an https origin or an https base path, e.g. <c>https://www.timssuite.com/api</c> (owner default
    /// D18: <c>/v1</c> stays mounted at <c>/api/v1</c>). Every call path (<c>v1/…</c>) is joined RELATIVE to it, so a
    /// base path is kept; a trailing slash is optional. Credentials, a query or a fragment make it invalid.
    /// </summary>
    public string? BaseUrl { get; init; }

    /// <summary>The OAuth 2.0 token endpoint (client credentials).</summary>
    public string? TokenUrl { get; init; }

    public string? ClientId { get; init; }

    public string? ClientSecret { get; init; }

    public string Scopes { get; init; } = DefaultScopes;

    /// <summary>The webhook subscription's current signing secret.</summary>
    public string? WebhookSigningSecret { get; init; }

    /// <summary>The previous secret, kept during a 24 h rotation so both signatures verify.</summary>
    public string? WebhookSigningSecretPrevious { get; init; }

    /// <summary>Per-call timeout. Bounded so a webhook's result fetch stays inside the sender's 10 s window.</summary>
    public int RequestTimeoutSeconds { get; init; } = 6;

    public bool IsConfigured =>
        IsHttpsUrl(BaseUrl) && IsHttpsUrl(TokenUrl) && IsUsable(ClientId) && IsUsable(ClientSecret)
        && IsUsable(WebhookSigningSecret) && RequestTimeoutSeconds is >= 1 and <= 30;

    /// <summary>The usable signing secrets, current first. Placeholders and blanks are dropped.</summary>
    public IReadOnlyList<string> SigningSecrets =>
        new[] { WebhookSigningSecret, WebhookSigningSecretPrevious }.Where(IsUsable).Select(s => s!.Trim()).ToList();

    /// <summary>Set values must be well-formed even while unused, so a typo surfaces at startup, not at first use.</summary>
    public bool IsValid() =>
        (string.IsNullOrWhiteSpace(BaseUrl) || IsHttpsUrl(BaseUrl))
        && (string.IsNullOrWhiteSpace(TokenUrl) || IsHttpsUrl(TokenUrl))
        && RequestTimeoutSeconds is >= 1 and <= 30
        && Scopes.Length <= 200;

    public static bool IsUsable(string? value) =>
        !string.IsNullOrWhiteSpace(value) && !string.Equals(value.Trim(), TerraformPlaceholder, StringComparison.Ordinal);

    private static bool IsHttpsUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
        && uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0;

    /// <summary>
    /// <see cref="BaseUrl"/> with exactly one trailing slash, so <c>new Uri(ResolvedBaseUri, "v1/…")</c> keeps its path:
    /// <c>https://host/api</c> and <c>https://host/api/</c> both resolve <c>v1/assignments</c> to
    /// <c>https://host/api/v1/assignments</c>, and an origin to <c>https://host/v1/assignments</c>. Only valid when
    /// <see cref="IsConfigured"/>.
    /// </summary>
    public Uri ResolvedBaseUri
    {
        get
        {
            var trimmed = BaseUrl!.Trim();
            return new Uri(trimmed.EndsWith('/') ? trimmed : trimmed + "/", UriKind.Absolute);
        }
    }
}
