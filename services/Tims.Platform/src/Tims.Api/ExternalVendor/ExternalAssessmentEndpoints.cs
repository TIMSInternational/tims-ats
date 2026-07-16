using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.RateLimiting;
using Tims.Application.ExternalVendor;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.ExternalVendor;

namespace Tims.Api.ExternalVendor;

/// <summary>
/// The external-vendor assessment READ endpoints (Phase-5 Slice 1) — the C# port of
/// <c>external.getAssessmentResults</c> / <c>external.getAssessmentResult</c>. Both are authenticated by
/// the ApiKey scheme (a valid <c>tims_</c> key → ExternalApiKey principal), gated by the
/// <c>assessment:read</c> role grant (<see cref="PermissionService"/>, the SAME kernel as staff, over the
/// <c>external</c> role's seeded grants) AND the <c>assessment:read</c> scope (<see cref="ExternalScope"/>,
/// DEFAULT enforcement — an empty-scope key IS a wildcard here, NOT alwaysEnforce), and carry the per-key
/// rate-limit filter. Read-only; the KEY is the principal (no staff User).
/// </summary>
public static class ExternalAssessmentEndpoints
{
    private const string AssessmentModule = "assessment";
    private const string ReadAction = "read";
    private const string AssessmentReadScope = "assessment:read";
    private static readonly string[] ExternalRole = ["external"];

    public static void MapExternalAssessmentEndpoints(this WebApplication app)
    {
        // list — cursor-paginated bulk sync of completed assessment profiles (full v1 payload).
        app.MapGet("/external/assessment-results", async (
                int? take,
                Guid? cursor,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PermissionService permissionService,
                ExternalAssessmentReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeAsync(user, httpContext, permissionService, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var takeValue = take ?? 25;
                if (takeValue < 1 || takeValue > 25)
                {
                    return Results.BadRequest(new { error = "take must be between 1 and 25" });
                }

                var result = await useCase.ListAsync(gate.Principal!, takeValue, cursor?.ToString(), cancellationToken);
                return Results.Ok(new { items = result.Items, nextCursor = result.NextCursor });
            })
            .RequireAuthorization(ApiKeyAuthenticationHandler.SchemeName)
            .AddEndpointFilter<ApiKeyRateLimitFilter>()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ExternalGetAssessmentResults");

        // getOne — a single assessment profile by assignment id (full v1 payload) or 404 (INV-G).
        app.MapGet("/external/assessment-results/{assignmentId:guid}", async (
                Guid assignmentId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PermissionService permissionService,
                ExternalAssessmentReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeAsync(user, httpContext, permissionService, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                try
                {
                    var v1 = await useCase.GetOneAsync(gate.Principal!, assignmentId.ToString(), cancellationToken);
                    return Results.Ok(v1);
                }
                catch (ExternalAssessmentNotFoundException)
                {
                    return Results.NotFound(new { message = ExternalAssessmentNotFoundException.NotFoundMessage });
                }
            })
            .RequireAuthorization(ApiKeyAuthenticationHandler.SchemeName)
            .AddEndpointFilter<ApiKeyRateLimitFilter>()
            .Produces<ExternalAssessmentResultV1>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("ExternalGetAssessmentResult");
    }

    // Scope + grant gate (the requireExternalPermission analog). The ApiKey scheme has already
    // authenticated (org + scopes claims present); enforce the assessment:read SCOPE (default: empty
    // scopes = wildcard) then the assessment:read GRANT for the `external` role. On success, build the
    // read principal (key id = audit actor + scope userId) with the request's IP / user-agent.
    private static async Task<GateResult> AuthorizeAsync(
        ClaimsPrincipal user, HttpContext httpContext, PermissionService permissionService, CancellationToken cancellationToken)
    {
        var organizationId = user.FindFirst(ApiKeyAuthenticationHandler.OrganizationIdClaimType)?.Value;
        var apiKeyId = user.FindFirst(ApiKeyAuthenticationHandler.ApiKeyIdClaimType)?.Value;
        if (string.IsNullOrEmpty(organizationId) || string.IsNullOrEmpty(apiKeyId))
        {
            // The ApiKey policy would already have 401'd; defensive belt-and-suspenders.
            return GateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        var scopes = user.FindAll(ApiKeyAuthenticationHandler.ScopeClaimType).Select(c => c.Value).ToList();
        if (!ExternalScope.ExternalScopeSatisfied(AssessmentReadScope, scopes, alwaysEnforceScope: false))
        {
            return GateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        var decision = await permissionService.CheckAsync(
            new AccessPrincipal(ExternalRole, organizationId, IsPlatformOwner: false),
            AssessmentModule,
            ReadAction,
            cancellationToken);
        // Fail closed on a denied decision OR a missing resolved scope: an allowed decision always
        // carries a scope, so a null Scope is a contract violation — never silently default to
        // Organization (which would run the query unscoped). The RESOLVED scope is threaded onto the
        // principal so the use case's ScopeWhereFor guard trips fail-closed for a narrow grant (INV-B).
        if (!decision.Allowed || decision.Scope is not { } resolvedScope)
        {
            return GateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        var principal = new ExternalReadPrincipal(
            organizationId,
            apiKeyId,
            resolvedScope,
            httpContext.Request.Headers["x-forwarded-for"].FirstOrDefault()
                ?? httpContext.Request.Headers["x-real-ip"].FirstOrDefault(),
            httpContext.Request.Headers.UserAgent.FirstOrDefault());
        return GateResult.Ok(principal);
    }

    private readonly struct GateResult
    {
        private GateResult(ExternalReadPrincipal? principal, IResult? failure)
        {
            Principal = principal;
            Failure = failure;
        }

        public ExternalReadPrincipal? Principal { get; }

        public IResult? Failure { get; }

        public static GateResult Ok(ExternalReadPrincipal principal) => new(principal, null);

        public static GateResult Fail(IResult failure) => new(null, failure);
    }
}
