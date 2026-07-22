using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Application.NineBox;
using Tims.Domain.Access;
using Tims.Domain.NineBox;
using Tims.Infrastructure.Access;

namespace Tims.Api.NineBox;

/// <summary>
/// The nine-box READ endpoints (Phase-5 Slice 10) — the C# port of the ELEVEN read procedures of the TS
/// <c>ninebox</c> router (the six writes are NOT ported). All eleven are
/// <c>permissionProcedure('ninebox','read')</c>, gated by <see cref="NineBoxStaffGate"/>, which returns the
/// resolved scope so each endpoint applies its OWN mechanic:
/// <list type="bullet">
///   <item><description><c>scopeWhereFor('nineBoxEvaluation')</c> (row filter): getGrid, getMovementHistory.</description></item>
///   <item><description><c>assertSubjectInScope(userId)</c> (out-of-set → 403): getEmployeeDetail, getAxisBreakdown.</description></item>
///   <item><description><c>requireOrgScope</c> (org-rollup, narrow → 403, Codex F3): listCalibrations,
///     getBenchStrength, getDashboardKpis.</description></item>
///   <item><description>HAND-ROLLED calibration gate (org/company → any; narrow → created-by OR member, 404/403):
///     getCalibration. Created-by-OR-member self list: myCalibrations. Grant-only PURE: simulate, getQuadrantPlan.</description></item>
/// </list>
/// INTERNAL reads = raw model / kernel shape, NO <c>schemaVersion</c>. Input validation runs AFTER auth (tRPC
/// parity). Dark-by-default behind <see cref="PlatformOptions.NineBoxReadEnabled"/> (mapped only when on, or at
/// build-time OpenAPI generation).
/// </summary>
public static class NineBoxReadEndpoints
{
    private const string EvaluationSubjectForbidden = "No puedes ver esta evaluacion";
    private const string CalibrationNotFound = "Sesion de calibracion no encontrada";
    private const string CommitteeForbidden = "Solo un miembro del comite puede ver esta sesion";

    public static void MapNineBoxReadEndpoints(this WebApplication app)
    {
        // 1. getGrid — gate → scopeWhereFor('nineBoxEvaluation') + teamId/unitId/companyId userId intersect.
        app.MapGet("/ninebox/grid", async (
                [FromQuery(Name = "period")] string? period,
                [FromQuery(Name = "teamId")] string? teamId,
                [FromQuery(Name = "unitId")] string? unitId,
                [FromQuery(Name = "companyId")] string? companyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (RequirePeriod(period) is not { } validPeriod)
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                if (!TryOptionalUuid(teamId, out var team)
                    || !TryOptionalUuid(unitId, out var unit)
                    || !TryOptionalUuid(companyId, out var company))
                {
                    return Results.BadRequest(new { error = "invalid_filters" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                try
                {
                    var scope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.NineBoxEvaluation, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                    var view = await useCase.GetGridAsync(
                        gate.Context!.OrganizationId, validPeriod, new GridFilter(team, unit, company), scope, cancellationToken);
                    return Results.Ok(view);
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
            .Produces<GridView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxGetGrid");

        // 2. getEmployeeDetail — gate → assertSubjectInScope(userId) (out-of-set → 403) → evaluation + history.
        app.MapGet("/ninebox/employee/{userId:guid}", async (
                Guid userId,
                [FromQuery(Name = "period")] string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (RequirePeriod(period) is not { } validPeriod)
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                if (await AssertSubjectAsync(anchorLoaderFactory, gate, userId, cancellationToken) is { } forbidden)
                {
                    return forbidden;
                }

                var view = await useCase.GetEmployeeDetailAsync(
                    gate.Context!.OrganizationId, userId, validPeriod, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<EmployeeDetailView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxGetEmployeeDetail");

        // 3. getAxisBreakdown — gate → assertSubjectInScope → findFirstOrThrow (missing → 404).
        app.MapGet("/ninebox/employee/{userId:guid}/axis-breakdown", async (
                Guid userId,
                [FromQuery(Name = "period")] string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (RequirePeriod(period) is not { } validPeriod)
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                if (await AssertSubjectAsync(anchorLoaderFactory, gate, userId, cancellationToken) is { } forbidden)
                {
                    return forbidden;
                }

                var view = await useCase.GetAxisBreakdownAsync(
                    gate.Context!.OrganizationId, userId, validPeriod, cancellationToken);
                return view is null ? Results.NotFound(new { message = "Evaluacion no encontrada" }) : Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<AxisBreakdownView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("NineBoxGetAxisBreakdown");

        // 4. getMovementHistory — gate → scopeWhereFor('nineBoxEvaluation') + userId/companyId intersect.
        app.MapGet("/ninebox/movement-history", async (
                [FromQuery(Name = "userId")] string? userIdFilter,
                [FromQuery(Name = "companyId")] string? companyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalUuid(userIdFilter, out var filterUserId) || !TryOptionalUuid(companyId, out var company))
                {
                    return Results.BadRequest(new { error = "invalid_filters" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                try
                {
                    var scope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.NineBoxEvaluation, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                    var view = await useCase.GetMovementHistoryAsync(
                        gate.Context!.OrganizationId, new MovementFilter(filterUserId, company), scope, cancellationToken);
                    return Results.Ok(view);
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
            .Produces<MovementHistoryView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxGetMovementHistory");

        // 5. simulate — gate only (PURE). Input validated AFTER auth: userId uuid, scores in [0,100].
        app.MapGet("/ninebox/simulate", async (
                [FromQuery(Name = "userId")] string? userIdRaw,
                [FromQuery(Name = "newPotentialScore")] double? newPotentialScore,
                [FromQuery(Name = "newPerformanceScore")] double? newPerformanceScore,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (string.IsNullOrEmpty(userIdRaw) || !Guid.TryParse(userIdRaw, out var simUserId)
                    || newPotentialScore is not { } pot || newPerformanceScore is not { } perf
                    || !IsScoreValid(pot) || !IsScoreValid(perf))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                return Results.Ok(NineBoxReadUseCase.Simulate(simUserId.ToString(), pot, perf));
            })
            .RequireAuthorization()
            .Produces<SimulateView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxSimulate");

        // 6. listCalibrations — gate → org-rollup gate (narrow → 403, F3) → all org sessions (100, createdAt desc).
        app.MapGet("/ninebox/calibrations", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var rows = await useCase.ListCalibrationsAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<CalibrationListRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxListCalibrations");

        // 7. getCalibration — gate → HAND-ROLLED membership gate (org/company → any; narrow → created-by OR member).
        app.MapGet("/ninebox/calibrations/{id:guid}", async (
                Guid id,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = gate.Context!.OrganizationId;
                var callerId = Guid.Parse(gate.Context!.UserId);

                // Org/company scopes see any in-org session; narrow scopes (committee members) may only read a
                // session they CREATED or are a MEMBER of (mirror ninebox.ts:299-319).
                if (gate.Scope!.Value is not (AccessScope.Organization or AccessScope.Company))
                {
                    var anchor = await useCase.GetCalibrationAnchorAsync(orgId, id, cancellationToken);
                    if (anchor is null)
                    {
                        return Results.NotFound(new { message = CalibrationNotFound });
                    }

                    if (anchor.CreatedById != callerId)
                    {
                        var isMember = await useCase.IsCalibrationMemberAsync(orgId, id, callerId, cancellationToken);
                        if (!isMember)
                        {
                            return Results.Json(new { message = CommitteeForbidden }, statusCode: StatusCodes.Status403Forbidden);
                        }
                    }
                }

                var detail = await useCase.GetCalibrationAsync(orgId, id, cancellationToken);
                return detail is null ? Results.NotFound(new { message = CalibrationNotFound }) : Results.Ok(detail);
            })
            .RequireAuthorization()
            .Produces<CalibrationDetailView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("NineBoxGetCalibration");

        // 8. myCalibrations — gate → hand-rolled created-by-OR-member self list (NOT org-wide, NOT scopeWhereFor).
        app.MapGet("/ninebox/my-calibrations", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var callerId = Guid.Parse(gate.Context!.UserId);
                var rows = await useCase.MyCalibrationsAsync(gate.Context!.OrganizationId, callerId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<MyCalibrationRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxMyCalibrations");

        // 9. getQuadrantPlan — gate only (PURE). quadrant ≤ 100 (validated AFTER auth).
        app.MapGet("/ninebox/quadrant-plan", async (
                [FromQuery(Name = "quadrant")] string? quadrant,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CancellationToken cancellationToken) =>
            {
                var gate = await NineBoxStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (string.IsNullOrEmpty(quadrant) || quadrant.Length > 100)
                {
                    return Results.BadRequest(new { error = "invalid_quadrant" });
                }

                return Results.Ok(NineBoxReadUseCase.GetQuadrantPlan(quadrant));
            })
            .RequireAuthorization()
            .Produces<QuadrantPlanResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxGetQuadrantPlan");

        // 10. getBenchStrength — gate → org-rollup gate → quadrant distribution + half-up ratio kernel.
        app.MapGet("/ninebox/bench-strength", async (
                [FromQuery(Name = "period")] string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (RequirePeriod(period) is not { } validPeriod)
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                var view = await useCase.GetBenchStrengthAsync(gate.Context!.OrganizationId, validPeriod, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<BenchStrengthView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxGetBenchStrength");

        // 11. getDashboardKpis — gate → org-rollup gate → counts + quadrant distribution.
        app.MapGet("/ninebox/dashboard-kpis", async (
                [FromQuery(Name = "period")] string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                NineBoxReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (RequirePeriod(period) is not { } validPeriod)
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                var view = await useCase.GetDashboardKpisAsync(gate.Context!.OrganizationId, validPeriod, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<DashboardKpisView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("NineBoxGetDashboardKpis");
    }

    // The org-rollup gate (reads #6/#10/#11): the staff gate THEN requireOrgScope (narrow → 403, Codex F3).
    private static async Task<NineBoxGateResult> AuthorizeOrgRollupAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var gate = await NineBoxStaffGate.AuthorizeAsync(
            user, httpContext, principalResolver, permissionService, options, cancellationToken);
        if (gate.Failure is not null)
        {
            return gate;
        }

        return OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value)
            ? gate
            : NineBoxGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
    }

    // The subject-scope gate (reads #2/#3): the target userId must be inside the caller's subject set
    // (own/team/unit/org/company). Out-of-set → 403 "No puedes ver esta evaluacion" (the C# assertSubjectInScope).
    // Returns the 403 IResult on failure, or null when the subject is in scope.
    private static async Task<IResult?> AssertSubjectAsync(
        IAnchorLoaderFactory anchorLoaderFactory,
        NineBoxGateResult gate,
        Guid targetUserId,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(gate.Context!.OrganizationId);
        var callerId = Guid.Parse(gate.Context!.UserId);
        var anchors = anchorLoaderFactory.Create(orgId, callerId);
        try
        {
            var satisfied = await SubjectInScope.IsSatisfiedAsync(
                gate.Scope!.Value, anchors, callerId.ToString(), targetUserId.ToString(), cancellationToken);
            return satisfied
                ? null
                : Results.Json(new { message = EvaluationSubjectForbidden }, statusCode: StatusCodes.Status403Forbidden);
        }
        finally
        {
            await DisposeAnchorsAsync(anchors);
        }
    }

    // period: required, max 100. TS z.string().max(100) laxly ACCEPTS an empty string; we reject empty too
    // (→ 400), consistent with rejecting malformed empty input (an empty period is nonsensical and never sent
    // by the FE, so not observable) — a deliberate improvement, NOT strict Zod parity. Absent (null) and
    // over-length both → null → 400.
    private static string? RequirePeriod(string? period) =>
        string.IsNullOrEmpty(period) || period.Length > 100 ? null : period;

    // Optional uuid (TS z.string().uuid().optional()): an OMITTED param (null) is valid → absent (out = null,
    // no filter). A PRESENT value must parse as a uuid — an empty string ("?teamId=") or any non-uuid is a
    // present-but-invalid value → 400 (mirrors Zod .uuid() rejecting a present empty/non-uuid; the earlier
    // "empty = absent" reading widened the accepted surface vs TS). Query binding: omitted → null, "?x=" → "".
    private static bool TryOptionalUuid(string? value, out Guid? parsed)
    {
        if (value is null)
        {
            parsed = null;
            return true;
        }

        if (Guid.TryParse(value, out var guid))
        {
            parsed = guid;
            return true;
        }

        parsed = null;
        return false;
    }

    // simulate score Zod parity: number in [0, 100].
    private static bool IsScoreValid(double value) => value is >= 0 and <= 100;

    private static async Task DisposeAnchorsAsync(IAnchorLoader anchors)
    {
        if (anchors is IAsyncDisposable disposable)
        {
            await disposable.DisposeAsync();
        }
    }
}
