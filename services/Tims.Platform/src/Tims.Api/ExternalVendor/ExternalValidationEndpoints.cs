using Tims.Api.Http;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Tims.Api.Authentication;
using Tims.Api.RateLimiting;
using Tims.Application.ExternalVendor;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.ExternalVendor;

namespace Tims.Api.ExternalVendor;

/// <summary>
/// The external-vendor validation WRITE endpoint (Phase-5 Slice 2) — the C# port of
/// <c>external.submitValidationResult</c> (Sprint 1.6). Authenticated by the ApiKey scheme (a valid
/// <c>tims_</c> key → ExternalApiKey principal), gated by the <c>validation:update</c> role grant
/// (<see cref="PermissionService"/>, the SAME kernel as staff, over the <c>external</c> role's grants) AND
/// the <c>validation:write</c> scope with <b>alwaysEnforceScope: true</b> (<see cref="ExternalScope"/> —
/// an empty-scope key is NOT a wildcard here, so seeding the grant can never silently widen an existing
/// key), and carries the per-key rate-limit filter. The KEY is the principal; the body carries only
/// <c>{ status, result, notes? }</c> — never the api key or the validation id (the route owns the id).
/// </summary>
public static class ExternalValidationEndpoints
{
    private const string ValidationModule = "validation";
    private const string UpdateAction = "update";
    private const string ValidationWriteScope = "validation:write";
    private static readonly string[] ExternalRole = ["external"];

    public static void MapExternalValidationEndpoints(this WebApplication app)
    {
        // submit — the atomic pending-only vendor write; 200 v1 / 400 bounds / 404 / 409.
        app.MapPost("/external/validations/{validationId:guid}/result", async (
                Guid validationId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PermissionService permissionService,
                ExternalValidationSubmitUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeAsync(user, httpContext, permissionService, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // Read the body as a raw JsonNode (NOT a typed body parameter) so the Zod-parity parse can
                // tell an ABSENT `notes` from an explicit `notes: null` (a typed nullable collapses both to
                // null) AND so the inferred schema does not shadow .Accepts<SubmitValidationBody>(): the DTO
                // remains the accurate OpenAPI request schema. Malformed / empty / `null`-literal → 400.
                ExternalValidationSubmitCommand command;
                try
                {
                    var body = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
                    command = ExternalValidationSubmitCommand.Create(body);
                }
                catch (ExternalValidationInvalidCommandException ex)
                {
                    return Results.BadRequest(new { error = ex.Message });
                }
                catch (System.Text.Json.JsonException)
                {
                    return Results.BadRequest(new { error = "request body must be valid JSON" });
                }

                try
                {
                    var v1 = await useCase.SubmitAsync(gate.Principal!, validationId.ToString(), command, cancellationToken);
                    return Results.Ok(v1);
                }
                catch (ExternalValidationNotFoundException)
                {
                    return Results.NotFound(new { message = ExternalValidationNotFoundException.NotFoundMessage });
                }
                catch (ExternalValidationConflictException)
                {
                    return Results.Conflict(new { message = ExternalValidationConflictException.ConflictMessage });
                }
            })
            .RequireAuthorization(ApiKeyAuthenticationHandler.SchemeName)
            .AddEndpointFilter<ApiKeyRateLimitFilter>()
            // Advertise the ACCURATE request schema to OpenAPI even though the handler binds a raw JsonNode
            // for FIX-2 present-null detection: status + result required (non-null), result an object, notes
            // optional non-null string, and NO null body (a typed DTO, not a nullable JsonNode).
            .Accepts<SubmitValidationBody>("application/json")
            .Produces<ExternalValidationResultV1>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("ExternalSubmitValidationResult");
    }

    // Scope + grant gate (the externalPermissionProcedure analog). The ApiKey scheme has already
    // authenticated (org + scopes claims present); enforce the validation:write SCOPE with alwaysEnforce
    // (empty scopes are NOT a wildcard for this write), then the validation:update GRANT for the
    // `external` role. Fail closed on a denied decision OR a missing resolved scope (an allowed decision
    // always carries a scope, so a null Scope is a contract violation). The write itself is a single-id,
    // org-scoped updateMany + RLS, so no per-row scope narrowing (ScopeWhereFor) is applicable here.
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
        if (!ExternalScope.ExternalScopeSatisfied(ValidationWriteScope, scopes, alwaysEnforceScope: true))
        {
            return GateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        var decision = await permissionService.CheckAsync(
            new AccessPrincipal(ExternalRole, organizationId, IsPlatformOwner: false),
            ValidationModule,
            UpdateAction,
            cancellationToken);
        if (!decision.Allowed || decision.Scope is null)
        {
            return GateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        var principal = new ExternalValidationSubmitPrincipal(
            organizationId,
            apiKeyId,
            httpContext.ClientIpFor(),
            httpContext.Request.Headers.UserAgent.FirstOrDefault());
        return GateResult.Ok(principal);
    }

    private readonly struct GateResult
    {
        private GateResult(ExternalValidationSubmitPrincipal? principal, IResult? failure)
        {
            Principal = principal;
            Failure = failure;
        }

        public ExternalValidationSubmitPrincipal? Principal { get; }

        public IResult? Failure { get; }

        public static GateResult Ok(ExternalValidationSubmitPrincipal principal) => new(principal, null);

        public static GateResult Fail(IResult failure) => new(null, failure);
    }
}

/// <summary>
/// The OpenAPI request-schema contract for the submit body: <c>{ status, result, notes? }</c>. This type
/// is NOT what the handler binds (it parses a raw <see cref="JsonNode"/> for present-null detection) — it
/// exists purely so <c>.Accepts&lt;SubmitValidationBody&gt;()</c> emits an ACCURATE schema:
/// <see cref="Status"/> + <see cref="Result"/> are required (non-null; <c>[Required]</c> on non-nullable
/// members), <see cref="Result"/> is a JSON object, and <see cref="Notes"/> is an OPTIONAL non-null string.
/// The api key (principal) and the validation id (route) are NEVER part of the body.
/// </summary>
public sealed record SubmitValidationBody(
    [property: Required] string Status,
    [property: Required] JsonObject Result,
    string? Notes);
