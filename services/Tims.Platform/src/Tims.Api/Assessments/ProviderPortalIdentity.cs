using System.Security.Claims;
using Tims.Application.CandidateConsent;
using Tims.Application.PlatformInvitations;

namespace Tims.Api.Assessments;

/// <summary>
/// The candidate identity of every AS-5 portal route: the Supabase session's email, CONFIRMED with the auth service (the
/// self-service withdrawal's rule). With <c>mailer_autoconfirm</c> on, "confirmed" proves nothing, so the routes fail
/// closed with 503. A verified identity for another subject than the token's is a 403.
/// </summary>
public static class ProviderPortalIdentity
{
    /// <summary>The verified email, or the response to return instead.</summary>
    public static async Task<(string? Email, IResult? Failure)> VerifyAsync(
        ClaimsPrincipal user, HttpContext httpContext, IInvitationIdentityProvider identities, IAuthSettingsProbe authSettings,
        CancellationToken cancellationToken)
    {
        var sub = user.FindFirst("sub")?.Value;
        var token = BearerToken(httpContext);
        if (string.IsNullOrEmpty(sub) || token is null)
        {
            return (null, Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        if (!await authSettings.RequiresEmailConfirmationAsync(cancellationToken))
        {
            return (null, Unavailable());
        }

        SetupIdentity? identity;
        try
        {
            identity = await identities.VerifyAsync(token, cancellationToken);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or System.Text.Json.JsonException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            return (null, Unavailable());
        }

        if (identity is null || !string.Equals(identity.Id, sub, StringComparison.Ordinal))
        {
            return (null, Results.Json(new { code = "email_not_verified" }, statusCode: StatusCodes.Status403Forbidden));
        }

        return (identity.Email, null);
    }

    private static IResult Unavailable() =>
        Results.Json(new { error = "self_service_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);

    private static string? BearerToken(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers.Authorization.ToString();
        const string prefix = "Bearer ";
        return header.StartsWith(prefix, StringComparison.Ordinal) && header.Length > prefix.Length
            ? header[prefix.Length..].Trim()
            : null;
    }
}
