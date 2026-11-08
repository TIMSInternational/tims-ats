using System.Security.Claims;
using Tims.Application.Assessments.Providers;
using Tims.Application.CandidateConsent;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Assessments.Providers;

namespace Tims.Api.Assessments;

/// <summary>
/// AS-5 candidate and provider-facing routes, dark behind <c>Platform:AssessmentProvidersEnabled</c>:
/// <list type="bullet">
///   <item><description><c>POST /portal/assessment-attempts/{attemptId}/launch</c> — the candidate launches one of their
///   attempts. Identity is the Supabase session's email, CONFIRMED with the auth service (the self-service withdrawal's
///   rule: with <c>mailer_autoconfirm</c> on, "confirmed" proves nothing, so the route fails closed with 503). The
///   attempt must belong to a candidate with that email (else 404). Body: optional per-purpose consents the candidate
///   just gave. Returns the provider's short-lived candidate token in the body only (<c>Cache-Control: no-store</c>),
///   never in a URL, never logged. Rate-limited on the strict <c>auth</c> tier.</description></item>
///   <item><description><c>POST /webhooks/tims-assessments</c> — anonymous; authenticated by the <c>TIMS-Signature</c>
///   HMAC over the raw body with a 300 s replay window, de-duplicated on <c>TIMS-Event-Id</c>. 200 / 400 / 503.
///   </description></item>
/// </list>
/// </summary>
public static class ProviderCandidateEndpoints
{
    public const string LaunchPathPrefix = "/portal/assessment-attempts/";
    public const string LaunchPathSuffix = "/launch";
    public const string WebhookPath = "/webhooks/tims-assessments";

    /// <summary>
    /// True for the candidate launch route in any spelling routing matches (case-insensitive, optional trailing slash),
    /// so the strict <c>auth</c> rate-limit tier cannot be sidestepped.
    /// </summary>
    public static bool IsLaunchRoute(PathString path)
    {
        if (path.Value is not { Length: > 0 } value)
        {
            return false;
        }

        var trimmed = value.TrimEnd('/');
        if (!trimmed.StartsWith(LaunchPathPrefix, StringComparison.OrdinalIgnoreCase)
            || !trimmed.EndsWith(LaunchPathSuffix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var id = trimmed[LaunchPathPrefix.Length..^LaunchPathSuffix.Length];
        return Guid.TryParse(id, out _);
    }

    public static void MapProviderCandidateEndpoints(this WebApplication app)
    {
        app.MapPost(LaunchPathPrefix + "{attemptId:guid}" + LaunchPathSuffix, async (
                Guid attemptId, ClaimsPrincipal user, HttpContext httpContext, IInvitationIdentityProvider identities,
                IAuthSettingsProbe authSettings, LaunchProviderAttemptUseCase useCase, TimeProvider timeProvider,
                ILoggerFactory loggers, CancellationToken cancellationToken) =>
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                httpContext.Response.Headers["Referrer-Policy"] = "no-referrer";
                var sub = user.FindFirst("sub")?.Value;
                var token = BearerToken(httpContext);
                if (string.IsNullOrEmpty(sub) || token is null)
                {
                    return Results.StatusCode(StatusCodes.Status401Unauthorized);
                }

                if (!await authSettings.RequiresEmailConfirmationAsync(cancellationToken))
                {
                    return Results.Json(new { error = "self_service_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
                }

                SetupIdentity? identity;
                try
                {
                    identity = await identities.VerifyAsync(token, cancellationToken);
                }
                catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or System.Text.Json.JsonException
                    || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
                {
                    return Results.Json(new { error = "self_service_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
                }

                if (identity is null || !string.Equals(identity.Id, sub, StringComparison.Ordinal))
                {
                    return Results.Json(new { code = "email_not_verified" }, statusCode: StatusCodes.Status403Forbidden);
                }

                var node = await ProviderEndpointJson.TryReadAsync(httpContext, cancellationToken);
                if (!node.Ok || !LaunchProviderAttemptUseCase.TryParseBody(node.Node, out var consents))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.LaunchAsync(
                    attemptId, identity.Email, consents, timeProvider.GetUtcNow(), cancellationToken);
                // Outcome only: never the token, the email or the attempt's candidate.
                loggers.CreateLogger("Tims.Api.Assessments").LogInformation(
                    "Assessment provider launch outcome {Outcome}", result.Outcome);
                return result.Outcome switch
                {
                    LaunchOutcome.Launched => Results.Ok(new ProviderLaunchResponse(
                        result.Launch!.Delivery, result.Launch.CandidateToken,
                        result.Launch.CandidateToken is null ? null : "Bearer",
                        result.Launch.ExpiresAt, result.Launch.ApiBaseUrl, result.Launch.HostedUrl)),
                    LaunchOutcome.NotFound => Results.NotFound(),
                    LaunchOutcome.ConsentWithdrawn => Results.Conflict(new { error = "consent_withdrawn" }),
                    LaunchOutcome.NotLaunchable => Results.Conflict(new { error = "attempt_not_launchable" }),
                    LaunchOutcome.NotReady => Results.Conflict(new { error = "attempt_not_ready" }),
                    LaunchOutcome.Expired => Results.Json(new { error = "attempt_expired" }, statusCode: StatusCodes.Status410Gone),
                    LaunchOutcome.ConsentRequired => Results.Conflict(new { error = "consent_required", missingConsents = result.Missing }),
                    LaunchOutcome.ConsentRejected => Results.UnprocessableEntity(new { error = "consent_rejected", code = result.Detail }),
                    LaunchOutcome.ProviderRefused => Results.Json(
                        new { error = "provider_refused", code = result.Detail }, statusCode: StatusCodes.Status502BadGateway),
                    LaunchOutcome.ProviderUnconfigured => Results.Json(
                        new { error = "provider_unconfigured" }, statusCode: StatusCodes.Status503ServiceUnavailable),
                    _ => Results.Json(new { error = "provider_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable),
                };
            })
            .RequireAuthorization()
            .Accepts<ProviderLaunchBody>("application/json")
            .Produces<ProviderLaunchResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict).Produces(StatusCodes.Status410Gone)
            .Produces(StatusCodes.Status422UnprocessableEntity).Produces(StatusCodes.Status429TooManyRequests)
            .Produces(StatusCodes.Status502BadGateway).Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderLaunch")
            .WithTags("AssessmentProviders");

        app.MapPost(WebhookPath, async (
                HttpContext httpContext, ProviderWebhookUseCase useCase, TimeProvider timeProvider, ILoggerFactory loggers,
                CancellationToken cancellationToken) =>
            {
                var body = await ReadRawBodyAsync(httpContext, ProviderWebhookUseCase.MaxBodyBytes, cancellationToken);
                var logger = loggers.CreateLogger("Tims.Api.Assessments");
                if (body is null)
                {
                    logger.LogWarning("Assessment provider webhook rejected: body missing or too large");
                    return Results.BadRequest(new { error = "rejected" });
                }

                var headers = httpContext.Request.Headers;
                int? deliveryAttempt = int.TryParse(headers["TIMS-Delivery-Attempt"].ToString(), out var n) && n is >= 1 and <= 50
                    ? n
                    : null;
                var result = await useCase.HandleAsync(
                    body, headers[WebhookSignature.HeaderName].ToString(), headers["TIMS-Event-Id"].ToString(),
                    headers["TIMS-Event-Type"].ToString(), deliveryAttempt, timeProvider.GetUtcNow(), cancellationToken);
                // Outcome + reason code only: never the body, the signature or ids of people.
                logger.LogInformation("Assessment provider webhook {Outcome} ({Reason})", result.Outcome, result.Reason);
                return result.Outcome switch
                {
                    WebhookOutcome.Rejected => Results.BadRequest(new { error = "rejected" }),
                    WebhookOutcome.RetryLater => Results.Json(new { error = "retry_later" }, statusCode: StatusCodes.Status503ServiceUnavailable),
                    _ => Results.Ok(new { status = result.Outcome.ToString().ToLowerInvariant() }),
                };
            })
            .AllowAnonymous()
            .Produces(StatusCodes.Status200OK).Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderWebhook")
            .WithTags("AssessmentProviders");
    }

    /// <summary>The raw request bytes (the signature covers them exactly), or null when empty or over the limit.</summary>
    public static async Task<byte[]?> ReadRawBodyAsync(HttpContext httpContext, int maxBytes, CancellationToken cancellationToken)
    {
        if (httpContext.Request.ContentLength > maxBytes)
        {
            return null;
        }

        var buffer = new byte[maxBytes + 1];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await httpContext.Request.Body.ReadAsync(buffer.AsMemory(length), cancellationToken);
            if (read == 0)
            {
                break;
            }

            length += read;
        }

        return length is 0 || length > maxBytes ? null : buffer.AsSpan(0, length).ToArray();
    }

    private static string? BearerToken(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers.Authorization.ToString();
        const string prefix = "Bearer ";
        return header.StartsWith(prefix, StringComparison.Ordinal) && header.Length > prefix.Length
            ? header[prefix.Length..].Trim()
            : null;
    }
}

/// <summary>OpenAPI request schema for a launch: the consents the candidate just gave, one per purpose.</summary>
public sealed class ProviderLaunchBody
{
    public IReadOnlyList<ProviderLaunchConsentBody>? Consents { get; init; }
}

public sealed class ProviderLaunchConsentBody
{
    public string Purpose { get; init; } = string.Empty;

    public string TextVersion { get; init; } = string.Empty;

    public string Locale { get; init; } = string.Empty;
}

/// <summary>
/// The launch handed to the candidate's own browser. <c>native</c>: a short-lived token for <c>/v1/sessions*</c> at
/// <c>ApiBaseUrl</c>. <c>link_out</c> (PCA): no token, the provider's <c>HostedUrl</c>. Redacting ToString: never logged.
/// </summary>
public sealed class ProviderLaunchResponse(
    string delivery, string? candidateToken, string? tokenType, DateTimeOffset expiresAt, string apiBaseUrl, string? hostedUrl)
{
    public string Delivery { get; } = delivery;

    public string? CandidateToken { get; } = candidateToken;

    public string? TokenType { get; } = tokenType;

    public DateTimeOffset ExpiresAt { get; } = expiresAt;

    public string ApiBaseUrl { get; } = apiBaseUrl;

    public string? HostedUrl { get; } = hostedUrl;

    public override string ToString() => $"ProviderLaunchResponse {{ Delivery = {Delivery}, CandidateToken = [redacted] }}";
}
