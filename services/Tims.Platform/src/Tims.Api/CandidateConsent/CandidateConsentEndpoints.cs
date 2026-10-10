using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.CandidateConsent;
using Tims.Application.Identity;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Access;
using Tims.Infrastructure.CandidateConsent;

namespace Tims.Api.CandidateConsent;

/// <summary>
/// Candidate data-processing consent (#312, #313), dark by default behind
/// <see cref="PlatformOptions.CandidateConsentEnabled"/>:
/// <list type="bullet">
///   <item><description><c>GET /tenant/candidates/{candidateId}/consent</c> — <c>candidate:read</c> + org scope. Status,
///   per-application evidence, latest deletion request. 200 / 401 / 403 / 404.</description></item>
///   <item><description><c>POST /tenant/candidates/{candidateId}/consent/withdrawal</c> — <c>candidate:update</c> + org
///   scope. Records a withdrawal the organization received (channel, optional reason, optional deletion request);
///   idempotent; audited in-transaction. 200 / 400 / 401 / 403 / 404.</description></item>
///   <item><description><c>POST /portal/consent/withdrawal</c> — the candidate's own self-service withdrawal. Any
///   Supabase session whose email Supabase reports CONFIRMED (re-verified server-side against the auth service, not
///   read from the token); withdraws every candidate of that org with that exact email and files a deletion
///   request. Uniform 202 whether or not a candidate exists. 202 / 400 / 401 / 403 / 404 (unknown org) / 503. Fails
///   CLOSED (503 <c>self_service_unavailable</c>) unless the auth service reports that email confirmation is REQUIRED
///   (<see cref="IAuthSettingsProbe"/>): with <c>mailer_autoconfirm</c> on, "confirmed" proves nothing.</description></item>
///   <item><description><c>GET /tenant/data-subject-requests</c> — see <see cref="DataSubjectRequestEndpoints"/>.</description></item>
/// </list>
/// Order: auth (401/403) → body validation (400) → org-scope (403) → write; bodies are parsed AFTER the gate
/// (TRAP 9). The tenant is always the caller's resolved org (staff) or the org of the public slug (self-service).
/// </summary>
public static class CandidateConsentEndpoints
{
    public const string PortalWithdrawalPath = "/portal/consent/withdrawal";
    private const string NotFoundMessage = "Candidato no encontrado";

    /// <summary>Body of every self-service 503 (auth settings unknown/unsafe, or identity service unconfigured/down).</summary>
    public static readonly SelfServiceUnavailableBody SelfServiceUnavailable = new(
        "self_service_unavailable",
        "Esta opción no está disponible en este momento. Para revocar su autorización, comuníquese directamente con la organización.");

    private static IResult Unavailable() =>
        Results.Json(SelfServiceUnavailable, statusCode: StatusCodes.Status503ServiceUnavailable);

    /// <summary>
    /// True for the self-service route in any spelling routing matches (case-insensitive, optional trailing slash),
    /// so the strict <c>auth</c> rate-limit tier cannot be sidestepped.
    /// </summary>
    public static bool IsPortalWithdrawalRoute(PathString path) =>
        path.Value is { Length: > 0 } value &&
        string.Equals(value.TrimEnd('/'), PortalWithdrawalPath, StringComparison.OrdinalIgnoreCase);

    public static void MapCandidateConsentEndpoints(this WebApplication app)
    {
        app.MapDataSubjectRequestEndpoints();

        app.MapGet("/tenant/candidates/{candidateId:guid}/consent", async (
                Guid candidateId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                CandidateConsentUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await CandidateConsentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "read",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.GetAsync(gate.OrganizationId, candidateId, cancellationToken);
                return ToResult(result);
            })
            .RequireAuthorization()
            .Produces<CandidateConsentView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("CandidateConsentGet");

        app.MapPost("/tenant/candidates/{candidateId:guid}/consent/withdrawal", async (
                Guid candidateId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                CandidateConsentUseCase useCase, TimeProvider timeProvider, DataSubjectRequestNotifier notifier,
                IOptions<InvitationDeliveryOptions> delivery, ILoggerFactory loggers, CancellationToken cancellationToken) =>
            {
                var gate = await CandidateConsentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "update",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !CandidateConsentUseCase.TryParseStaffWithdrawal(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.WithdrawByStaffAsync(
                    gate.OrganizationId, gate.UserId, candidateId, input,
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                await NotifyAdminsAsync(result.Notice, notifier, delivery.Value, loggers);
                return ToResult(result);
            })
            .RequireAuthorization()
            .Accepts<StaffConsentWithdrawalBody>("application/json")
            .Produces<CandidateConsentView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .WithName("CandidateConsentWithdrawByStaff");

        app.MapPost(PortalWithdrawalPath, async (
                ClaimsPrincipal user, HttpContext httpContext, IInvitationIdentityProvider identities,
                IAuthSettingsProbe authSettings, CandidateConsentUseCase useCase, TimeProvider timeProvider,
                DataSubjectRequestNotifier notifier, IOptions<InvitationDeliveryOptions> delivery, ILoggerFactory loggers,
                CancellationToken cancellationToken) =>
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                var sub = user.FindFirst("sub")?.Value;
                var token = BearerToken(httpContext);
                if (string.IsNullOrEmpty(sub) || token is null)
                {
                    return Results.StatusCode(StatusCodes.Status401Unauthorized);
                }

                // A confirmed email is only proof of inbox ownership when the project REQUIRES confirmation. Unknown
                // (settings unreachable/unparseable) or auto-confirm on → closed.
                if (!await authSettings.RequiresEmailConfirmationAsync(cancellationToken))
                {
                    return Unavailable();
                }

                // The email must be CONFIRMED, and that is asked of the auth service itself — a signed token's email
                // claim says nothing about whether its holder ever proved they own the inbox.
                SetupIdentity? identity;
                try
                {
                    identity = await identities.VerifyAsync(token, cancellationToken);
                }
                catch (InvalidOperationException)
                {
                    return Unavailable();
                }
                catch (HttpRequestException)
                {
                    return Unavailable();
                }

                if (identity is null || !string.Equals(identity.Id, sub, StringComparison.Ordinal))
                {
                    return Results.Json(new { code = "email_not_verified" }, statusCode: StatusCodes.Status403Forbidden);
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !CandidateConsentUseCase.TryParsePortalWithdrawal(node, out var slug))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.WithdrawBySubjectAsync(
                    slug, identity.Email, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                if (!result.OrganizationFound)
                {
                    return Results.NotFound();
                }

                // Counts only: never the email, the candidate ids or the slug.
                loggers.CreateLogger("Tims.Api.CandidateConsent").LogInformation(
                    "Candidate self-service consent withdrawal: {Withdrawn} withdrawn, {Requests} deletion requests",
                    result.CandidatesWithdrawn, result.DeletionRequestsCreated);
                await NotifyAdminsAsync(result.Notice, notifier, delivery.Value, loggers);
                return Results.Json(new PortalWithdrawalAck(true), statusCode: StatusCodes.Status202Accepted);
            })
            .RequireAuthorization()
            .Accepts<PortalConsentWithdrawalBody>("application/json")
            .Produces<PortalWithdrawalAck>(StatusCodes.Status202Accepted)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status429TooManyRequests)
            .Produces<SelfServiceUnavailableBody>(StatusCodes.Status503ServiceUnavailable)
            .WithName("CandidateConsentWithdrawBySubject");
    }

    /// <summary>
    /// Startup signal (warning, never a failure): consent is ON but the auth service the self-service route depends
    /// on (<c>Invitations:SupabaseUrl</c> / <c>Invitations:SupabaseServiceKey</c>) is missing or still the terraform
    /// placeholder, so every self-service withdrawal answers 503. Returns whether it warned.
    /// </summary>
    public static bool WarnIfSelfServiceUnconfigured(ILogger logger, bool consentEnabled, string? supabaseUrl, string? serviceKey)
    {
        if (!consentEnabled || SupabaseAuthSettingsProbe.IsConfigured(supabaseUrl, serviceKey)) return false;
        logger.LogWarning(
            "Platform:CandidateConsentEnabled is on but Invitations:SupabaseUrl/Invitations:SupabaseServiceKey are not " +
            "configured (blank, invalid or the terraform placeholder): every candidate self-service consent withdrawal " +
            "will answer 503. Set Invitations__SupabaseUrl and Invitations__SupabaseServiceKey.");
        return true;
    }

    /// <summary>
    /// Post-commit email to the org admins about a NEW data subject request. Never fails the request; logs counts only
    /// (no addresses, no candidate data).
    /// </summary>
    private static async Task NotifyAdminsAsync(
        DataSubjectRequestNotice? notice, DataSubjectRequestNotifier notifier, InvitationDeliveryOptions delivery,
        ILoggerFactory loggers)
    {
        if (notice is null || notice.Recipients.Count == 0)
        {
            return;
        }

        var logger = loggers.CreateLogger("Tims.Api.CandidateConsent");
        if (!Uri.TryCreate(delivery.AppOrigin, UriKind.Absolute, out var origin))
        {
            logger.LogWarning("Data subject request email skipped: Invitations:AppOrigin is not a valid origin");
            return;
        }

        // The request is committed: a client that disconnects must not cancel the admins' email.
        var (accepted, failed) = await notifier.SendAsync(notice, origin, CancellationToken.None);
        if (failed > 0)
        {
            logger.LogWarning(
                "Data subject request admin email: {Accepted} accepted, {Failed} not accepted", accepted, failed);
        }
        else
        {
            logger.LogInformation("Data subject request admin email: {Accepted} accepted", accepted);
        }
    }

    private static string? BearerToken(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers.Authorization.ToString();
        const string prefix = "Bearer ";
        return header.StartsWith(prefix, StringComparison.Ordinal) && header.Length > prefix.Length
            ? header[prefix.Length..].Trim()
            : null;
    }

    private static IResult ToResult(CandidateConsentResult result) => result.Outcome switch
    {
        CandidateConsentOutcome.NotFound => Results.NotFound(new { message = NotFoundMessage }),
        _ => Results.Ok(result.View),
    };

    private static async Task<(bool Ok, JsonNode? Node)> TryReadJsonAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        try
        {
            var node = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
            return (true, node);
        }
        catch (JsonException)
        {
            return (false, null);
        }
        catch (InvalidOperationException)
        {
            return (false, null);
        }
    }
}

/// <summary>OpenAPI request schema for the staff withdrawal. The handler parses the raw JSON strictly.</summary>
public sealed class StaffConsentWithdrawalBody
{
    /// <summary>How the organization received the withdrawal: email | phone | in_person | letter | other.</summary>
    [Required]
    [MaxLength(30)]
    public string Channel { get; init; } = string.Empty;

    [MaxLength(CandidateConsentConstants.MaxReasonLength)]
    public string? Reason { get; init; }

    /// <summary>Also file a deletion (supresión) request for staff to resolve.</summary>
    public bool? RequestDeletion { get; init; }
}

/// <summary>OpenAPI request schema for the self-service withdrawal.</summary>
public sealed class PortalConsentWithdrawalBody
{
    [Required]
    [MaxLength(CandidateConsentUseCase.MaxSlugLength)]
    public string OrganizationSlug { get; init; } = string.Empty;
}

/// <summary>The self-service 503 body: a machine code and a Spanish message the portal can show as-is.</summary>
public sealed record SelfServiceUnavailableBody(string Code, string Message);

/// <summary>The uniform self-service answer.</summary>
public sealed record PortalWithdrawalAck(bool Received);
