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
///   just gave. Returns the hosted launch (D16): the TIMS hosted player's single-use URL (native) or the provider's URL
///   (link-out), its expiry and the registered origins allowed to frame the player, in the body only
///   (<c>Cache-Control: no-store</c>, <c>Referrer-Policy: no-referrer</c>), never logged. No candidate token exists on
///   this path. Rate-limited on the strict <c>auth</c> tier.</description></item>
///   <item><description><c>POST /webhooks/tims-assessments</c> — anonymous; authenticated by the <c>TIMS-Signature</c>
///   HMAC over the raw body with a 300 s replay window, de-duplicated on the signed body's <c>event_id</c> (a
///   <c>TIMS-Event-Id</c> or <c>TIMS-Event-Type</c> header that differs from the body is a 400). 200 / 400 / 503.
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
                var (email, failure) = await ProviderPortalIdentity.VerifyAsync(
                    user, httpContext, identities, authSettings, cancellationToken);
                if (failure is not null)
                {
                    return failure;
                }

                var node = await ProviderEndpointJson.TryReadAsync(httpContext, cancellationToken);
                if (!node.Ok || !LaunchProviderAttemptUseCase.TryParseBody(node.Node, out var consents))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.LaunchAsync(
                    attemptId, email!, consents, timeProvider.GetUtcNow(), cancellationToken);
                // Outcome only: never the token, the email or the attempt's candidate.
                loggers.CreateLogger("Tims.Api.Assessments").LogInformation(
                    "Assessment provider launch outcome {Outcome}", result.Outcome);
                return result.Outcome switch
                {
                    LaunchOutcome.Launched => Results.Ok(new ProviderLaunchResponse(
                        result.Launch!.Delivery, result.Launch.ExpiresAt, result.Launch.HostedUrl, result.Launch.FrameAncestors)),
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
/// The hosted launch (D16) handed to the candidate's own browser. <c>HostedUrl</c>: the TIMS hosted player's URL with a
/// single-use launch code (<c>native</c>; open it at once, it expires at <c>ExpiresAt</c>), or the provider's URL
/// (<c>link_out</c>). <c>FrameAncestors</c>: the registered origins that may frame the player; the portal frames it only
/// when its own origin is listed, and otherwise opens it top-level. Redacting ToString: never logged.
/// </summary>
public sealed class ProviderLaunchResponse(
    string delivery, DateTimeOffset expiresAt, string hostedUrl, IReadOnlyList<string> frameAncestors)
{
    public string Delivery { get; } = delivery;

    public DateTimeOffset ExpiresAt { get; } = expiresAt;

    public string HostedUrl { get; } = hostedUrl;

    public IReadOnlyList<string> FrameAncestors { get; } = frameAncestors;

    public override string ToString() => $"ProviderLaunchResponse {{ Delivery = {Delivery}, HostedUrl = [redacted] }}";
}
