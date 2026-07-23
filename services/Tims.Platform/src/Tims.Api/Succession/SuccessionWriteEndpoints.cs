using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Application.Succession;
using Tims.Domain.Access;
using Tims.Domain.Succession;
using Tims.Infrastructure.Access;

namespace Tims.Api.Succession;

/// <summary>
/// The succession WRITE endpoints (Phase-5 Slice 14) — the C# port of the 5 mutation bodies of the TS
/// <c>succession</c> router (addCriticalRole / addSuccessor / removeSuccessor / updateSuccessorReadiness /
/// updateCriticalRoleBand; all inline <c>prisma.*</c> — there is no TS service/repo). The 5 writes carry DIFFERENT
/// scope mechanics on the SAME <c>succession:create/update/delete</c> grants — the action-parameterized
/// <see cref="SuccessionStaffGate"/> authorizes the grant and RETURNS the resolved scope, and each endpoint applies
/// its own mechanic (identical pattern to <see cref="SuccessionReadEndpoints"/>):
/// <list type="bullet">
///   <item><description>addCriticalRole → <c>requireOrgScope</c> (org governance; a narrow leader/hrbp grant → 403).</description></item>
///   <item><description>addSuccessor → <c>assertScoped('criticalRole')</c> parent IDOR probe (→ 404) THEN
///     <c>assertSubjectInScope(userId)</c> write-rule subject check (out-of-set → 403).</description></item>
///   <item><description>removeSuccessor / updateSuccessorReadiness → <c>assertScoped('successor')</c> by-id probe (→ 404).</description></item>
///   <item><description>updateCriticalRoleBand → <c>assertScoped('criticalRole')</c> by-id probe (→ 404).</description></item>
/// </list>
/// <c>criticality</c>/<c>readiness</c>/<c>type</c> are plain-string enum sets enforced at the endpoint (→ 400 AFTER
/// auth, tRPC parity). addSuccessor stamps <c>addedById = caller</c> server-side (never from input) and maps the
/// <c>@@unique([criticalRoleId, userId])</c> violation → 409 (documented improvement over the TS 500). Every write
/// runs UNDER TenantScope + an explicit org filter. Dark-by-default behind
/// <see cref="PlatformOptions.SuccessionWriteEnabled"/> (mapped only when on, or at build-time OpenAPI generation).
/// </summary>
public static class SuccessionWriteEndpoints
{
    private const string CreateAction = "create";
    private const string UpdateAction = "update";
    private const string DeleteAction = "delete";

    private const string SubjectForbiddenMessage = "No puedes agregar este sucesor";
    private const string SuccessorConflictMessage = "Este sucesor ya está asignado a este rol";
    private const string SuccessorNotFoundMessage = "Sucesor no encontrado";
    private const string RoleNotFoundMessage = "Rol critico no encontrado";

    private const int MaxTitleLength = 255;
    private const int MaxPositionIdLength = 100;
    private const int MaxDevelopmentPlanLength = 20000;
    private const int MaxTargetBandLevelLength = 50;

    public static void MapSuccessionWriteEndpoints(this WebApplication app)
    {
        // ---- addCriticalRole — POST /succession/critical-roles. requireOrgScope. 200 (full row) / 400 / 401 / 403. ----
        app.MapPost("/succession/critical-roles", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                SuccessionWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // Codex F2: tRPC validates `.input()` (→ 400) BEFORE the resolver runs `requireOrgScope` (→ 403), so
                // a malformed body must 400 even for a narrow-scoped caller. Read+validate the body FIRST, then gate.
                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildAddCriticalRole(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                // Defining an org-critical role is org governance (succession.ts:130-132) → org/company scope only;
                // a narrow (team/unit/own) succession:create caller → 403, no INSERT.
                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                // Codex H2: a null return = a provided currentHolderId/companyId/unitId is not in the caller's org
                // (a cross-tenant reference) → 400, no INSERT.
                var row = await useCase.AddCriticalRoleAsync(
                    gate.Context!.OrganizationId, input, timeProvider.GetUtcNow(), cancellationToken);
                return row is null
                    ? Results.BadRequest(new { error = "invalid_reference" })
                    : Results.Ok(row);
            })
            .RequireAuthorization()
            .Accepts<AddCriticalRoleBody>("application/json")
            .Produces<CriticalRoleRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SuccessionAddCriticalRole");

        // ---- addSuccessor — POST /succession/critical-roles/{criticalRoleId}/successors. ----
        // assertScoped(criticalRole) → 404, THEN assertSubjectInScope(userId) → 403; dedup → 409.
        app.MapPost("/succession/critical-roles/{criticalRoleId:guid}/successors", async (
                Guid criticalRoleId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                SuccessionWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildAddSuccessor(criticalRoleId, node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                try
                {
                    // (1) The parent critical role must be in the caller's grant (succession.ts:154-161).
                    // Out-of-grant / nonexistent → ScopedNotFoundException (404, "Rol critico no encontrado").
                    await scopedProbe.AssertScopedAsync(
                        ScopedEntity.CriticalRole, criticalRoleId, gate.Scope!.Value, anchors, orgId, callerId,
                        cancellationToken);

                    // (2) The proposed successor must be a user in the caller's subject set (succession.ts:163-168).
                    // Write-rule subject check (no row to probe yet) → out-of-set → 403 "No puedes agregar este sucesor".
                    var satisfied = await SubjectInScope.IsSatisfiedAsync(
                        gate.Scope!.Value, anchors, callerId.ToString(), input.UserId.ToString(), cancellationToken);
                    if (!satisfied)
                    {
                        return Results.Json(
                            new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                    }
                }
                catch (ScopedNotFoundException ex)
                {
                    return Results.NotFound(new { message = ex.Message });
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var result = await useCase.AddSuccessorAsync(
                    gate.Context!.OrganizationId, callerId, input, timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    // Codex H1: the target userId is not a member of the caller's org (a cross-tenant reference the
                    // org/company-scope assertSubjectInScope no-op would otherwise allow) → 403, no INSERT.
                    AddSuccessorOutcome.SubjectNotInOrg => Results.Json(
                        new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden),
                    AddSuccessorOutcome.Conflict => Results.Json(
                        new { message = SuccessorConflictMessage }, statusCode: StatusCodes.Status409Conflict),
                    _ => Results.Ok(result.Row),
                };
            })
            .RequireAuthorization()
            .Accepts<AddSuccessorBody>("application/json")
            .Produces<SuccessorRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("SuccessionAddSuccessor");

        // ---- removeSuccessor — DELETE /succession/successors/{successorId}. assertScoped(successor) → 404. ----
        app.MapDelete("/succession/successors/{successorId:guid}", async (
                Guid successorId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                SuccessionWriteUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, DeleteAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);
                var probe = await ProbeSuccessorAsync(
                    scopedProbe, anchorLoaderFactory, successorId, gate.Scope!.Value, orgId, callerId, cancellationToken);
                if (probe is not null)
                {
                    return probe;
                }

                var deleted = await useCase.RemoveSuccessorAsync(gate.Context!.OrganizationId, successorId, cancellationToken);
                return deleted is null
                    ? Results.NotFound(new { message = SuccessorNotFoundMessage })
                    : Results.Ok(deleted);
            })
            .RequireAuthorization()
            .Produces<SuccessorScalarRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("SuccessionRemoveSuccessor");

        // ---- updateSuccessorReadiness — PATCH /succession/successors/{successorId}/readiness. assertScoped(successor) → 404. ----
        app.MapPatch("/succession/successors/{successorId:guid}/readiness", async (
                Guid successorId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                SuccessionWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildUpdateReadiness(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);
                var probe = await ProbeSuccessorAsync(
                    scopedProbe, anchorLoaderFactory, successorId, gate.Scope!.Value, orgId, callerId, cancellationToken);
                if (probe is not null)
                {
                    return probe;
                }

                var updated = await useCase.UpdateSuccessorReadinessAsync(
                    gate.Context!.OrganizationId, successorId, input, timeProvider.GetUtcNow(), cancellationToken);
                return updated is null
                    ? Results.NotFound(new { message = SuccessorNotFoundMessage })
                    : Results.Ok(updated);
            })
            .RequireAuthorization()
            .Accepts<UpdateSuccessorReadinessBody>("application/json")
            .Produces<SuccessorScalarRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .WithName("SuccessionUpdateSuccessorReadiness");

        // ---- updateCriticalRoleBand — PATCH /succession/critical-roles/{criticalRoleId}/band. assertScoped(criticalRole) → 404. ----
        app.MapPatch("/succession/critical-roles/{criticalRoleId:guid}/band", async (
                Guid criticalRoleId,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                SuccessionWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !TryBuildUpdateBand(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                try
                {
                    await scopedProbe.AssertScopedAsync(
                        ScopedEntity.CriticalRole, criticalRoleId, gate.Scope!.Value, anchors, orgId, callerId,
                        cancellationToken);
                }
                catch (ScopedNotFoundException ex)
                {
                    return Results.NotFound(new { message = ex.Message });
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var result = await useCase.UpdateCriticalRoleBandAsync(
                    gate.Context!.OrganizationId, criticalRoleId, input, timeProvider.GetUtcNow(), cancellationToken);
                return result is null
                    ? Results.NotFound(new { message = RoleNotFoundMessage })
                    : Results.Ok(result);
            })
            .RequireAuthorization()
            .Accepts<UpdateCriticalRoleBandBody>("application/json")
            .Produces<CriticalRoleBandResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .WithName("SuccessionUpdateCriticalRoleBand");
    }

    // The by-id assertScoped('successor') IDOR probe (removeSuccessor / updateSuccessorReadiness): a narrow-scoped
    // caller must not reach an out-of-scope / cross-org successor by id-guessing → 404 "Sucesor no encontrado".
    private static async Task<IResult?> ProbeSuccessorAsync(
        ScopedProbe scopedProbe, IAnchorLoaderFactory anchorLoaderFactory, Guid successorId, AccessScope scope,
        Guid orgId, Guid callerId, CancellationToken cancellationToken)
    {
        var anchors = anchorLoaderFactory.Create(orgId, callerId);
        try
        {
            await scopedProbe.AssertScopedAsync(
                ScopedEntity.Successor, successorId, scope, anchors, orgId, callerId, cancellationToken);
            return null;
        }
        catch (ScopedNotFoundException ex)
        {
            return Results.NotFound(new { message = ex.Message });
        }
        finally
        {
            await DisposeAnchorsAsync(anchors);
        }
    }

    // ---- Zod-parity input validation (runs AFTER auth) --------------------------------------------------------

    // addCriticalRole: title 1..255; criticality ∈ {critical,high,medium,low}; positionId? ≤100;
    // currentHolderId?/companyId?/unitId? valid uuid; flightRisk? 0..1. Codex F1: parsed from a JsonObject (NOT a
    // typed record) so an EXPLICIT null on a Zod `.optional()` (non-nullable) field, and an empty-string uuid, are
    // REJECTED (→ 400) rather than collapsed to "absent" (Zod `.optional()` / `.uuid()` parity).
    private static bool TryBuildAddCriticalRole(JsonNode? node, out AddCriticalRoleInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["title"] is not JsonValue titleValue || !titleValue.TryGetValue(out string? title) || title is null
            || title.Length < 1 || title.Length > MaxTitleLength
            || obj["criticality"] is not JsonValue critValue || !critValue.TryGetValue(out string? criticality)
            || !SuccessionCriticalityValues.IsValid(criticality)
            || !TryOptionalString(obj, "positionId", MaxPositionIdLength, out var positionId)
            || !TryOptionalGuid(obj, "currentHolderId", out var holder)
            || !TryOptionalGuid(obj, "companyId", out var company)
            || !TryOptionalGuid(obj, "unitId", out var unit)
            || !TryOptionalDouble(obj, "flightRisk", out var risk)
            || (risk is { } r && (r < 0 || r > 1)))
        {
            return false;
        }

        input = new AddCriticalRoleInput(title, positionId, holder, company, unit, criticality!, risk);
        return true;
    }

    // addSuccessor: userId uuid; readiness ∈ {ready_now,ready_1_year,ready_2_years,developing}; type ∈
    // {internal,external}; developmentPlan? ≤20000. criticalRoleId is the route param (authoritative). Codex F1:
    // JsonObject-parsed so an explicit-null developmentPlan (Zod `.optional()`) → 400, never treated as absent.
    private static bool TryBuildAddSuccessor(Guid criticalRoleId, JsonNode? node, out AddSuccessorInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["userId"] is not JsonValue userValue || !userValue.TryGetValue(out string? userIdRaw)
            || userIdRaw is null || !Guid.TryParseExact(userIdRaw, "D", out var userId)
            || obj["readiness"] is not JsonValue readyValue || !readyValue.TryGetValue(out string? readiness)
            || !SuccessionReadinessValues.IsValid(readiness)
            || obj["type"] is not JsonValue typeValue || !typeValue.TryGetValue(out string? type)
            || !SuccessionSuccessorTypeValues.IsValid(type)
            || !TryOptionalString(obj, "developmentPlan", MaxDevelopmentPlanLength, out var developmentPlan))
        {
            return false;
        }

        input = new AddSuccessorInput(criticalRoleId, userId, readiness!, type!, developmentPlan);
        return true;
    }

    // Zod `.string().max(max).optional()` from a JsonObject: absent key ⇒ (true, null); present key MUST be a JSON
    // string ≤max (an explicit null, a non-string, or an over-long value ⇒ false → 400).
    private static bool TryOptionalString(JsonObject obj, string key, int max, out string? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonValue v || !v.TryGetValue(out value) || value is null || value.Length > max)
        {
            return false;
        }

        return true;
    }

    // Zod `.string().uuid().optional()` from a JsonObject: absent key ⇒ (true, null); present key MUST be a canonical
    // 8-4-4-4-12 hyphenated uuid (an explicit null, "", a non-string, or a non-canonical form ⇒ false → 400). Uses
    // `TryParseExact(…, "D")` (NOT `TryParse`, which also accepts braces/parens/no-hyphen forms Zod `.uuid()` rejects)
    // — strict-format parity with `BillingReadEndpoints` (Codex).
    private static bool TryOptionalGuid(JsonObject obj, string key, out Guid? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonValue v || !v.TryGetValue(out string? raw) || string.IsNullOrEmpty(raw)
            || !Guid.TryParseExact(raw, "D", out var parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    // Zod `.number().optional()` from a JsonObject: absent key ⇒ (true, null); present key MUST be a JSON number (an
    // explicit null or a non-number ⇒ false → 400). Range is checked by the caller.
    private static bool TryOptionalDouble(JsonObject obj, string key, out double? value)
    {
        value = null;
        if (!obj.TryGetPropertyValue(key, out var propNode))
        {
            return true;
        }

        if (propNode is not JsonValue v || !v.TryGetValue(out double parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    // updateSuccessorReadiness: readiness ∈ the 4-set (required); developmentPlan? ≤20000 (applied only when the key
    // is present — an ABSENT optional is skipped, never nulled). An explicit JSON null / wrong type ⇒ 400.
    private static bool TryBuildUpdateReadiness(JsonNode? node, out UpdateSuccessorReadinessInput input)
    {
        input = null!;
        if (node is not JsonObject obj
            || obj["readiness"] is not JsonValue readinessValue
            || !readinessValue.TryGetValue(out string? readiness)
            || !SuccessionReadinessValues.IsValid(readiness))
        {
            return false;
        }

        string? developmentPlan = null;
        var hasDevelopmentPlan = false;
        if (obj.TryGetPropertyValue("developmentPlan", out var planNode))
        {
            // Present key: must be a string ≤20000 (Zod `.optional()` rejects an explicit null → 400).
            if (planNode is not JsonValue planValue
                || !planValue.TryGetValue(out developmentPlan)
                || developmentPlan.Length > MaxDevelopmentPlanLength)
            {
                return false;
            }

            hasDevelopmentPlan = true;
        }

        input = new UpdateSuccessorReadinessInput(readiness!, developmentPlan, hasDevelopmentPlan);
        return true;
    }

    // updateCriticalRoleBand: targetBandLevel REQUIRED-but-nullable (Zod `.nullable()`, NOT `.optional()`), string
    // ≤50 or null. An ABSENT key ⇒ 400; an explicit null clears the band; a non-string/over-long value ⇒ 400.
    private static bool TryBuildUpdateBand(JsonNode? node, out UpdateCriticalRoleBandInput input)
    {
        input = null!;
        if (node is not JsonObject obj || !obj.TryGetPropertyValue("targetBandLevel", out var bandNode))
        {
            return false;
        }

        if (bandNode is null)
        {
            input = new UpdateCriticalRoleBandInput(null);
            return true;
        }

        if (bandNode is not JsonValue bandValue
            || !bandValue.TryGetValue(out string? band)
            || band.Length > MaxTargetBandLevelLength)
        {
            return false;
        }

        input = new UpdateCriticalRoleBandInput(band);
        return true;
    }

    // Raw JsonNode read for every write body (all four builders distinguish absent vs present-null keys).
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

    private static async Task DisposeAnchorsAsync(IAnchorLoader anchors)
    {
        if (anchors is IAsyncDisposable disposable)
        {
            await disposable.DisposeAsync();
        }
    }
}

/// <summary>OpenAPI request schema for addCriticalRole (the accurate contract; the handler parses defensively).
/// The optional fields are declared LAST with <c>= null</c> defaults so the generated schema marks them non-required.</summary>
public sealed record AddCriticalRoleBody(
    [property: Required] string Title,
    [property: Required] string Criticality,
    string? PositionId = null,
    string? CurrentHolderId = null,
    string? CompanyId = null,
    string? UnitId = null,
    double? FlightRisk = null);

/// <summary>OpenAPI request schema for addSuccessor (criticalRoleId is the route param). developmentPlan optional.</summary>
public sealed record AddSuccessorBody(
    [property: Required] string UserId,
    [property: Required] string Readiness,
    [property: Required] string Type,
    string? DevelopmentPlan = null);

/// <summary>OpenAPI request schema for updateSuccessorReadiness. developmentPlan optional.</summary>
public sealed record UpdateSuccessorReadinessBody(
    [property: Required] string Readiness,
    string? DevelopmentPlan = null);

/// <summary>OpenAPI request schema for updateCriticalRoleBand. targetBandLevel is REQUIRED-but-nullable.</summary>
public sealed record UpdateCriticalRoleBandBody(
    [property: Required] string? TargetBandLevel);
