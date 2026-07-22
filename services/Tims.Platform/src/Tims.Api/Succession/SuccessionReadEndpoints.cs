using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Application.Succession;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Domain.Identity;
using Tims.Domain.Succession;
using Tims.Infrastructure.Access;

namespace Tims.Api.Succession;

/// <summary>
/// The succession READ endpoints (Phase-5 Slice 8) — the C# port of the NINE read procedures of the TS
/// <c>succession</c> router (the five writes are NOT ported). All nine are
/// <c>permissionProcedure('succession','read')</c>, gated by <see cref="SuccessionStaffGate"/>, which returns
/// the resolved scope so each endpoint applies its OWN mechanic:
/// <list type="bullet">
///   <item><description><c>scopeWhereFor</c> (row filter): listCriticalRoles (criticalRole + successor).</description></item>
///   <item><description><c>assertScoped('criticalRole')</c> IDOR probe (404-not-403) + scopeWhereFor:
///     getCriticalRole, getSuggestedSuccessors, simulateExit.</description></item>
///   <item><description><c>requireOrgScope</c> (org-rollup, narrow → 403, Codex F3): getFlightRisk,
///     getCompetencyCoverage, getRolesWithoutSuccessor, getCompGapAlerts, getDashboardKpis.</description></item>
/// </list>
/// getCompGapAlerts additionally enforces a SECONDARY <c>compensation:read</c> grant, applies that grant's
/// <c>scopeWhereFor('employeeCompensation')</c> ROW filter to the comp query (so an org-wide-succession /
/// narrow-compensation caller never reads org-wide comp-gaps), and audits every EXPOSED employeeCompensation
/// row fail-closed BEFORE returning. INTERNAL reads = raw model / kernel shape, NO
/// <c>schemaVersion</c>. Input validation runs AFTER auth (tRPC parity). Dark-by-default behind
/// <see cref="PlatformOptions.SuccessionReadEnabled"/> (mapped only when on, or at build-time OpenAPI gen).
/// </summary>
public static class SuccessionReadEndpoints
{
    private const string CompForbiddenMessage = "No tiene permiso para ver datos de compensacion";
    private const string RoleNotFoundMessage = "Rol critico no encontrado";
    private const string CompensationModule = "compensation";
    private const string ReadAction = "read";
    private const string EmployeeCompensationEntity = "employeeCompensation";

    public static void MapSuccessionReadEndpoints(this WebApplication app)
    {
        // 1. listCriticalRoles — gate → scopeWhereFor('criticalRole') + scopeWhereFor('successor') row filter.
        app.MapGet("/succession/critical-roles", async (
                [FromQuery(Name = "companyId")] string? companyId,
                [FromQuery(Name = "unitId")] string? unitId,
                [FromQuery(Name = "criticality")] string? criticality,
                [FromQuery(Name = "search")] string? search,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (ParseFilters(companyId, unitId, criticality, search) is not { } filters)
                {
                    return Results.BadRequest(new { error = "invalid_filters" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                try
                {
                    var roleScope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.CriticalRole, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                    var successorScope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.Successor, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);

                    var rows = await useCase.ListCriticalRolesAsync(
                        gate.Context!.OrganizationId, filters, roleScope, successorScope, cancellationToken);
                    return Results.Ok(rows);
                }
                catch (ScopeAnchorMissingException)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<ListCriticalRoleRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SuccessionListCriticalRoles");

        // 2. getCriticalRole — gate → assertScoped('criticalRole') IDOR probe (404) → scopeWhereFor('successor').
        app.MapGet("/succession/critical-roles/{criticalRoleId:guid}", async (
                Guid criticalRoleId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                try
                {
                    var probe = await AssertRoleScopeAsync(
                        scopedProbe, criticalRoleId, gate.Scope!.Value, anchors, orgId, userId, cancellationToken);
                    if (probe is not null)
                    {
                        return probe;
                    }

                    var successorScope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.Successor, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                    var row = await useCase.GetCriticalRoleAsync(
                        gate.Context!.OrganizationId, criticalRoleId, successorScope, cancellationToken);
                    return row is null ? Results.NotFound(new { message = RoleNotFoundMessage }) : Results.Ok(row);
                }
                catch (ScopeAnchorMissingException)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }
            })
            .RequireAuthorization()
            .Produces<CriticalRoleDetailRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("SuccessionGetCriticalRole");

        // 3. getFlightRisk — gate → org-rollup gate (narrow → 403, F3) → roles ≥ threshold + _count.
        app.MapGet("/succession/flight-risk", async (
                [FromQuery(Name = "threshold")] double? threshold,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (threshold is { } t && (t < 0 || t > 1))
                {
                    return Results.BadRequest(new { error = "invalid_threshold" });
                }

                var rows = await useCase.GetFlightRiskAsync(
                    gate.Context!.OrganizationId, threshold ?? 0.7, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<FlightRiskRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SuccessionGetFlightRisk");

        // 4. getCompetencyCoverage — gate → org-rollup gate → pure coverage kernel.
        app.MapGet("/succession/competency-coverage", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var rows = await useCase.GetCompetencyCoverageAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<CoverageRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SuccessionGetCompetencyCoverage");

        // 5. getRolesWithoutSuccessor — gate → org-rollup gate → roles with no successor.
        app.MapGet("/succession/roles-without-successor", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var rows = await useCase.GetRolesWithoutSuccessorAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<RoleWithoutSuccessorRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SuccessionGetRolesWithoutSuccessor");

        // 6. getCompGapAlerts — gate → org-rollup gate → SECONDARY compensation:read → field-auth read + audit.
        app.MapGet("/succession/comp-gap-alerts", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                SuccessionReadUseCase useCase,
                IDataAccessAuditor auditor,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // §21 secondary in-body grant: employeeCompensation.currentSalary is restricted and
                // succession:read is NOT its gate — a role granted succession:read WITHOUT compensation:read
                // must still be refused here (same pattern as the TS buildAccessForUser secondary check).
                var compDecision = await permissionService.CheckAsync(
                    gate.Context!, CompensationModule, ReadAction, cancellationToken);
                if (!compDecision.Allowed || compDecision.Roles is not { } compRoles)
                {
                    return Results.Json(new { message = CompForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                }

                // selectFor(compRoles, employeeCompensation) → which restricted fields may LEAVE the DB.
                var compFields = FieldClassification.SelectFor(compRoles, EmployeeCompensationEntity);

                // Codex hardening: succession:read may be org-wide while compensation:read is NARROW. Resolve
                // the employeeCompensation ROW scope from the COMPENSATION decision (not the succession scope)
                // and apply it as a query row filter — else a narrow-comp caller reads org-wide comp-gaps. The
                // anchor loader is per-USER + module-independent (same loader the scoped reads use). Org/company
                // comp scope → MatchAll (no anchor touch); narrow with a missing loader → 403 (TS FORBIDDEN parity).
                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                ScopePredicate compScope;
                try
                {
                    compScope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.EmployeeCompensation, compDecision.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                }
                catch (ScopeAnchorMissingException)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var result = await useCase.GetCompGapAlertsAsync(
                    gate.Context!.OrganizationId, compFields, compScope, cancellationToken);

                // §21 audit: one data_access_logs row per EXPOSED employeeCompensation record, fail-closed
                // (restricted) BEFORE serializing the alerts — a failed audit-write aborts pre-response.
                var actorId = AuditActor.ActorFor(gate.Context!);
                var ipAddress = ClientIp(httpContext);
                var userAgent = httpContext.Request.Headers.UserAgent.ToString();
                foreach (var recordId in result.AuditedCompIds)
                {
                    await auditor.LogAsync(
                        new DataAccessEvent(
                            gate.Context!.OrganizationId,
                            actorId,
                            EmployeeCompensationEntity,
                            recordId,
                            AuditAction.Read,
                            ipAddress,
                            string.IsNullOrEmpty(userAgent) ? null : userAgent),
                        cancellationToken: cancellationToken);
                }

                return Results.Ok(result.Alerts);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<CompGapAlert>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SuccessionGetCompGapAlerts");

        // 7. getSuggestedSuccessors — gate → assertScoped('criticalRole') → scopeWhereFor('nineBoxEvaluation').
        app.MapGet("/succession/critical-roles/{criticalRoleId:guid}/suggested-successors", async (
                Guid criticalRoleId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                try
                {
                    var probe = await AssertRoleScopeAsync(
                        scopedProbe, criticalRoleId, gate.Scope!.Value, anchors, orgId, userId, cancellationToken);
                    if (probe is not null)
                    {
                        return probe;
                    }

                    var evaluationScope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.NineBoxEvaluation, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                    var suggestions = await useCase.GetSuggestedSuccessorsAsync(
                        gate.Context!.OrganizationId, criticalRoleId, evaluationScope, cancellationToken);
                    return Results.Ok(suggestions);
                }
                catch (ScopeAnchorMissingException)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<SuggestedSuccessor>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("SuccessionGetSuggestedSuccessors");

        // 8. simulateExit — gate → assertScoped('criticalRole') → scopeWhereFor('successor').
        app.MapGet("/succession/critical-roles/{criticalRoleId:guid}/simulate-exit", async (
                Guid criticalRoleId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await SuccessionStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                try
                {
                    var probe = await AssertRoleScopeAsync(
                        scopedProbe, criticalRoleId, gate.Scope!.Value, anchors, orgId, userId, cancellationToken);
                    if (probe is not null)
                    {
                        return probe;
                    }

                    var successorScope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.Successor, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                    var view = await useCase.SimulateExitAsync(
                        gate.Context!.OrganizationId, criticalRoleId, successorScope, cancellationToken);
                    return view is null ? Results.NotFound(new { message = RoleNotFoundMessage }) : Results.Ok(view);
                }
                catch (ScopeAnchorMissingException)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }
            })
            .RequireAuthorization()
            .Produces<ExitSimulationView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("SuccessionSimulateExit");

        // 9. getDashboardKpis — gate → org-rollup gate → pure KPI kernel.
        app.MapGet("/succession/dashboard-kpis", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                SuccessionReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var kpis = await useCase.GetDashboardKpisAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(kpis);
            })
            .RequireAuthorization()
            .Produces<SuccessionKpiView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SuccessionGetDashboardKpis");
    }

    // The org-rollup gate (reads 3/4/5/6/9): the staff gate THEN requireOrgScope (narrow → 403, Codex F3).
    private static async Task<SuccessionGateResult> AuthorizeOrgRollupAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var gate = await SuccessionStaffGate.AuthorizeAsync(
            user, httpContext, principalResolver, permissionService, options, cancellationToken);
        if (gate.Failure is not null)
        {
            return gate;
        }

        return OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value)
            ? gate
            : SuccessionGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
    }

    // The by-id IDOR probe on the critical role (reads 2/7/8): a narrow-scoped caller must not reach an
    // out-of-scope role by id-guessing → ScopedNotFoundException (404, "Rol critico no encontrado").
    private static async Task<IResult?> AssertRoleScopeAsync(
        ScopedProbe scopedProbe,
        Guid criticalRoleId,
        AccessScope scope,
        IAnchorLoader anchors,
        Guid orgId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        try
        {
            await scopedProbe.AssertScopedAsync(
                ScopedEntity.CriticalRole, criticalRoleId, scope, anchors, orgId, userId, cancellationToken);
            return null;
        }
        catch (ScopedNotFoundException ex)
        {
            return Results.NotFound(new { message = ex.Message });
        }
    }

    // Zod parity for listCriticalRoles input: companyId/unitId optional uuid (bad → invalid), criticality
    // max 100, search max 200. Returns null when a bound/format is violated (→ 400, validated AFTER auth).
    private static CriticalRoleFilters? ParseFilters(
        string? companyId, string? unitId, string? criticality, string? search)
    {
        Guid? company = null;
        if (!string.IsNullOrEmpty(companyId))
        {
            if (!Guid.TryParse(companyId, out var parsed))
            {
                return null;
            }

            company = parsed;
        }

        Guid? unit = null;
        if (!string.IsNullOrEmpty(unitId))
        {
            if (!Guid.TryParse(unitId, out var parsed))
            {
                return null;
            }

            unit = parsed;
        }

        if (criticality is { Length: > 100 } || search is { Length: > 200 })
        {
            return null;
        }

        return new CriticalRoleFilters(
            company,
            unit,
            string.IsNullOrEmpty(criticality) ? null : criticality,
            string.IsNullOrEmpty(search) ? null : search);
    }

    // getCompGapAlerts audit IP: x-forwarded-for || x-real-ip (matches the TS header order).
    private static string? ClientIp(HttpContext httpContext)
    {
        var forwarded = httpContext.Request.Headers["x-forwarded-for"].ToString();
        if (!string.IsNullOrEmpty(forwarded))
        {
            return forwarded;
        }

        var realIp = httpContext.Request.Headers["x-real-ip"].ToString();
        return string.IsNullOrEmpty(realIp) ? null : realIp;
    }

    private static async Task DisposeAnchorsAsync(IAnchorLoader anchors)
    {
        if (anchors is IAsyncDisposable disposable)
        {
            await disposable.DisposeAsync();
        }
    }
}
