using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Application.Compensation;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Domain.Compensation;
using Tims.Domain.Identity;
using Tims.Infrastructure.Access;

namespace Tims.Api.Compensation;

/// <summary>
/// The FIVE FX-derived compensation READ endpoints (Phase-5 Slice 11c) — the C# port of the deferred FX reads of
/// the TS <c>compensation</c> router. All are <c>permissionProcedure('compensation','read')</c> via
/// <see cref="CompensationStaffGate"/>; band-distribution / pay-equity / total-comp-breakdown / dashboard-kpis add
/// the org-rollup gate (narrow → 403, Codex F3), simulate-adjustment does <c>assertSubjectInScope</c> +
/// <c>selectFor('employeeCompensation')</c> field-auth + fail-closed audit. Each resolves its FX rate from the
/// DB-pinned <c>fx_rates</c> (fail-soft cold-start). Dark-by-default behind <see cref="PlatformOptions.FxReadsEnabled"/>.
/// </summary>
public static class CompensationFxReadEndpoints
{
    private const string EmployeeCompensationEntity = "employeeCompensation";
    private const string SubjectForbiddenMessage = "No puedes simular ajustes para este usuario";
    private const string CompNotFoundMessage = "Compensacion no encontrada";

    public static void MapCompensationFxReadEndpoints(this WebApplication app)
    {
        // 1. getBandDistribution — org-gate → the FX per-band distribution.
        app.MapGet("/compensation/band-distribution", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                CompensationFxReadUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetBandDistributionAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<BandDistributionBand>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetBandDistribution");

        // 2. getPayEquity — org-gate → the single org-wide 'all' group.
        app.MapGet("/compensation/pay-equity", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                CompensationFxReadUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetPayEquityAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<CompPayEquityView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetPayEquity");

        // 3. getTotalCompBreakdown — org-gate → the FX-summed base/variable breakdown.
        app.MapGet("/compensation/total-comp-breakdown", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                CompensationFxReadUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetTotalCompBreakdownAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<TotalCompBreakdownView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetTotalCompBreakdown");

        // 4. getDashboardKpis — org-gate → the compensation dashboard KPIs.
        app.MapGet("/compensation/dashboard-kpis", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                CompensationFxReadUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetDashboardKpisAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<CompDashboardKpisView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetDashboardKpis");

        // 5. simulateAdjustment — subject-scope (403 out-of-set) + selectFor field-auth + fail-closed audit.
        app.MapGet("/compensation/simulate-adjustment", async (
                [FromQuery(Name = "userId")] string? userId,
                [FromQuery(Name = "proposedSalary")] double? proposedSalary,
                [FromQuery(Name = "currency")] string? currency,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, CompensationFxReadUseCase useCase,
                IDataAccessAuditor auditor, CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!Guid.TryParse(userId, out var subjectUserId) || proposedSalary is not { } salary || !(salary > 0)
                    || currency is { Length: not 3 })
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                try
                {
                    var satisfied = await SubjectInScope.IsSatisfiedAsync(
                        gate.Scope!.Value, anchors, callerId.ToString(), subjectUserId.ToString(), cancellationToken);
                    if (!satisfied)
                    {
                        return Results.Json(new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                    }
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var compFields = FieldClassification.SelectFor(gate.Roles!, EmployeeCompensationEntity);
                var result = await useCase.SimulateAdjustmentAsync(
                    gate.Context!.OrganizationId, subjectUserId, salary, currency, compFields, cancellationToken);
                switch (result.Kind)
                {
                    case SimulateAdjustmentResultKind.NotFound:
                        return Results.NotFound(new { message = CompNotFoundMessage });

                    // FIX 2: a REQUIRED cross-rate pin is missing → honest 503, NEVER a best-effort wrong %change
                    // (deliberate improvement over the TS uncaught 500, like the #141 clean-404 precedent).
                    case SimulateAdjustmentResultKind.FxUnavailable:
                        return Results.Json(new { error = "fx_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);

                    default:
                        // §21: simulateAdjustment reads employee_compensations (restricted, FULL+AUDIT). Fail-closed
                        // audit BEFORE serializing so a failed audit-write aborts pre-response.
                        await AuditAsync(auditor, gate.Context!, httpContext, result.RecordId!, cancellationToken);
                        // FIX 3: result.View is boxed to `object` so STJ serializes the RUNTIME type — the base 7
                        // fields for a non-entitled caller, or the derived 13 (all compa keys present) for an
                        // entitled one — never the declared base type (which would truncate the compa block).
                        return Results.Ok(result.View);
                }
            })
            .RequireAuthorization()
            // Document the DERIVED (superset) shape so the generated client types the six entitled-only
            // compa/band fields (nullable/optional — absent for a non-entitled caller, present-with-null for an
            // entitled caller whose subject has no band). The base-vs-derived choice is a runtime authorization
            // decision (Codex recheck LOW); the widest documented shape keeps the OpenAPI contract honest.
            .Produces<SimulateAdjustmentWithCompaView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("CompensationSimulateAdjustment");
    }

    private static async Task<CompensationGateResult> AuthorizeOrgRollupAsync(
        ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
        PermissionService permissionService, PlatformOptions options, CancellationToken cancellationToken)
    {
        var gate = await CompensationStaffGate.AuthorizeAsync(
            user, httpContext, principalResolver, permissionService, options, cancellationToken);
        if (gate.Failure is not null)
        {
            return gate;
        }

        return OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value)
            ? gate
            : CompensationGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
    }

    private static async Task AuditAsync(
        IDataAccessAuditor auditor, TenantContext context, HttpContext httpContext, string recordId,
        CancellationToken cancellationToken)
    {
        var forwarded = httpContext.Request.Headers["x-forwarded-for"].ToString();
        var realIp = httpContext.Request.Headers["x-real-ip"].ToString();
        var ipAddress = !string.IsNullOrEmpty(forwarded) ? forwarded : string.IsNullOrEmpty(realIp) ? null : realIp;
        var userAgent = httpContext.Request.Headers.UserAgent.ToString();
        await auditor.LogAsync(
            new DataAccessEvent(
                context.OrganizationId, AuditActor.ActorFor(context), EmployeeCompensationEntity, recordId,
                AuditAction.Read, ipAddress, string.IsNullOrEmpty(userAgent) ? null : userAgent),
            failClosed: true,
            cancellationToken: cancellationToken);
    }

    private static async Task DisposeAnchorsAsync(IAnchorLoader anchors)
    {
        if (anchors is IAsyncDisposable disposable)
        {
            await disposable.DisposeAsync();
        }
    }
}
