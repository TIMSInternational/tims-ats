using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Application.Validation;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Domain.Validation;
using Tims.Infrastructure.Access;

namespace Tims.Api.Validation;

/// <summary>
/// The STAFF pre-employment-validation WRITE endpoint (Phase-5) — the C# port of
/// <c>offerValidationsRouter.updateValidation</c>. Staff-JWT + the <c>offer:update</c> grant
/// (<see cref="PermissionService"/>), THEN the by-id IDOR probe on the PARENT offer
/// (<see cref="ScopedProbe"/> — the FIRST live <c>assertScoped</c> wiring in the C# surface): the caller's
/// resolved scope must reach the offer, else NOT_FOUND (never confirms the id). It is the SECOND
/// <c>efcoreStranglerWrite</c> writer on <c>preemployment_validations</c> (completed_by_id = the staff user,
/// completed_by_api_key_id = null → the single-completer XOR). Dark-by-default behind
/// <see cref="PlatformOptions.ValidationStaffWriteEnabled"/> (mapped only when on, or at build-time OpenAPI gen).
/// </summary>
public static class StaffValidationEndpoints
{
    private const string OfferModule = "offer";
    private const string UpdateAction = "update";
    private const string ValidationNotFoundMessage = "Validacion no encontrada";

    public static void MapStaffValidationEndpoints(this WebApplication app)
    {
        // updateValidation — partial staff write; 200 raw row / 400 bounds / 401 / 403 / 404 (missing or IDOR).
        app.MapPatch("/validations/{validationId:guid}", async (
                Guid validationId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                StaffValidationUpdateUseCase useCase,
                IOptions<PlatformOptions> platformOptions,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                // 1. Authorize BEFORE parsing input (tRPC middleware-before-Zod parity): resolve staff →
                //    offer:update grant → the resolved scope for the IDOR probe.
                var gate = await AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var context = gate.Context!;

                // 2. Parse the body — Zod-parity partial-update semantics (400 on a bound violation / bad JSON).
                StaffValidationUpdateCommand command;
                try
                {
                    var body = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
                    command = StaffValidationUpdateCommand.Create(body);
                }
                catch (StaffValidationInvalidCommandException ex)
                {
                    return Results.BadRequest(new { error = ex.Message });
                }
                catch (JsonException)
                {
                    return Results.BadRequest(new { error = "request body must be valid JSON" });
                }
                catch (InvalidOperationException)
                {
                    // ReadFromJsonAsync throws this for a missing / incompatible Content-Type — a client error
                    // (400), never a server fault (500).
                    return Results.BadRequest(new { error = "request body must be application/json" });
                }

                // 3. Fetch-then-probe hop: the route key is the validation id; fetch its parent offerId.
                var offerId = await useCase.FindOfferIdAsync(context.OrganizationId, validationId.ToString(), cancellationToken);
                if (offerId is null)
                {
                    return Results.NotFound(new { message = ValidationNotFoundMessage });
                }

                // 4. IDOR probe on the PARENT offer: a narrow-scoped caller must not reach an out-of-scope
                //    offer's validation by id-guessing → ScopedNotFoundException (404, "Oferta no encontrada").
                var orgId = Guid.Parse(context.OrganizationId);
                var userId = Guid.Parse(context.UserId);
                // The EF anchor loader owns a request-local DbContext; IAnchorLoader itself is not disposable,
                // so dispose the concrete IAsyncDisposable implementation in a finally.
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                try
                {
                    await scopedProbe.AssertScopedAsync(
                        ScopedEntity.Offer, offerId.Value, gate.Scope!.Value, anchors, orgId, userId, cancellationToken);
                }
                catch (ScopedNotFoundException ex)
                {
                    return Results.NotFound(new { message = ex.Message });
                }
                finally
                {
                    if (anchors is IAsyncDisposable disposableAnchors)
                    {
                        await disposableAnchors.DisposeAsync();
                    }
                }

                // 5. Apply the partial update; return the persisted raw row (null ⇒ vanished between probe/write).
                var row = await useCase.UpdateAsync(
                    context.OrganizationId, validationId.ToString(), command, userId, timeProvider.GetUtcNow(), cancellationToken);
                return row is null
                    ? Results.NotFound(new { message = ValidationNotFoundMessage })
                    : Results.Ok(row);
            })
            .RequireAuthorization()
            .Accepts<StaffValidationUpdateBody>("application/json")
            .Produces<StaffValidationRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("StaffUpdateValidation");
    }

    // Resolve the staff principal (the PrincipalResolutionMiddleware stash, else ResolveStaffAsync) and
    // enforce the offer:update grant via the SAME PermissionService kernel as tRPC. Unlike the org-rollup
    // reports there is NO org-gate: narrow scopes ARE allowed here, but the resolved scope is threaded to the
    // IDOR probe (a narrow caller only reaches offers within scope). unresolvable → 401; denied grant OR a
    // null resolved scope → 403; privileged org-less → 400.
    private static async Task<StaffValidationGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return StaffValidationGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, OfferModule, UpdateAction, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return StaffValidationGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return StaffValidationGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return StaffValidationGateResult.Ok(context, scope);
    }

    private static async Task<TenantContext?> ResolvePrincipalAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolvedPrincipal)
        {
            return resolvedPrincipal.Context;
        }

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
        {
            return null;
        }

        var resolution = await principalResolver.ResolveStaffAsync(
            sub,
            httpContext.Request.Headers.Cookie.ToString(),
            options.ImpersonationSecret,
            DateTime.UtcNow,
            cancellationToken);

        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }
}

/// <summary>Outcome of the staff-validation gate: the resolved principal + its scope, or the failure to return.</summary>
public readonly struct StaffValidationGateResult
{
    private StaffValidationGateResult(TenantContext? context, AccessScope? scope, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static StaffValidationGateResult Ok(TenantContext context, AccessScope scope) => new(context, scope, null);

    public static StaffValidationGateResult Fail(IResult failure) => new(null, null, failure);
}

/// <summary>
/// The OpenAPI request-schema contract for the staff update body: <c>{ status, result?, notes? }</c>. Not
/// what the handler binds (it parses a raw <see cref="JsonNode"/> for absent-vs-present-null partial-update
/// detection) — it exists purely so <c>.Accepts&lt;StaffValidationUpdateBody&gt;()</c> emits an accurate schema.
/// </summary>
public sealed record StaffValidationUpdateBody(
    [property: Required] string Status,
    JsonObject? Result,
    string? Notes);
