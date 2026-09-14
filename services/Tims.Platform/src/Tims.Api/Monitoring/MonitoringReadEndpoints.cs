using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Application.Monitoring;
using Tims.Domain.Access;
using Tims.Domain.Monitoring;

namespace Tims.Api.Monitoring;

/// <summary>
/// The monitoring READ endpoints (Phase-5 Q0b slice 1, issue #100) — the C# port of the SIX
/// <c>monitoring.*</c> READ procedures, all <c>permissionProcedure('monitoring','read')</c>, gated by
/// <see cref="MonitoringStaffGate"/>.
///
/// <para><b>Why this slice exists.</b> <c>routers/monitoring.ts</c> is the single hardest blocker in the
/// ownership-flip epic: it is the last TS Prisma reader of <c>surveys</c> (flip #64),
/// <c>survey_responses</c> (#64), <c>salary_adjustments</c> (#66) and <c>action_plans</c> (#68), and
/// before this slice monitoring had no C# counterpart at all. This surface is the prerequisite the flip
/// runbook §7b calls "the true gating item for #64".</para>
///
/// <para><b>The two WRITES are deliberately NOT here.</b> <c>dismissAlert</c> and
/// <c>configureAlertRules</c> are <c>permissionProcedure('monitoring','update')</c> mutations and belong
/// to a separate write slice, for three reasons: (1) the Phase-5 recipe routes reads first and writes
/// only after ("Route reads first… Start read-only, then writes"); (2) they would move <c>alerts</c>
/// out of <c>efcoreReadOnly</c> and <c>alert_rules</c> straight into <c>efcoreStranglerWrite</c>, which
/// needs its own one-active-writer flag discipline rather than riding a read flag; and (3) neither
/// write blocks any ownership flip — every blocking site the runbook lists is a READ. Porting them here
/// would enlarge the blast radius of the slice that unblocks the flips without unblocking anything
/// more.</para>
///
/// INTERNAL staff read ⇒ RAW procedure shape, NO <c>schemaVersion</c> envelope. Input validation runs
/// AFTER auth (tRPC middleware-before-Zod parity). Dark-by-default behind
/// <see cref="PlatformOptions.MonitoringReadEnabled"/> (mapped only when on, or at build-time OpenAPI gen).
/// </summary>
public static class MonitoringReadEndpoints
{
    private static readonly string[] TrendMetrics = ["headcount", "turnover", "engagement", "alerts"];
    private static readonly string[] TrendPeriods = ["6m", "12m", "24m"];
    private static readonly string[] AlertSeverities = ["info", "warning", "critical"];

    private const int DefaultPage = 1;
    private const int DefaultLimit = 20;
    private const int MaxLimit = 100;
    private const int MaxModuleLength = 100;

    public static void MapMonitoringReadEndpoints(this WebApplication app)
    {
        // 1. getExecutiveKpis — five org-wide counts; pendingAdjustments passes the k-anon floor.
        app.MapGet("/monitoring/executive-kpis", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                MonitoringReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await MonitoringStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                return Results.Ok(await useCase.GetExecutiveKpisAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<ExecutiveKpiView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("MonitoringGetExecutiveKpis");

        // 2. getModuleHealth — the fixed 8-module health projection (empty org ⇒ 8 honest zero rows).
        app.MapGet("/monitoring/module-health", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                MonitoringReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await MonitoringStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                return Results.Ok(await useCase.GetModuleHealthAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<ModuleHealthPoint>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("MonitoringGetModuleHealth");

        // 3. getActiveAlerts — paged ACTIVE alerts. Zod parity: module max 100, severity enum,
        //    page >= 1, 1 <= limit <= 100, all optional with the TS defaults.
        app.MapGet("/monitoring/alerts", async (
                [FromQuery] string? module,
                [FromQuery] string? severity,
                [FromQuery] int? page,
                [FromQuery] int? limit,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                MonitoringReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await MonitoringStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (module is { Length: > MaxModuleLength }
                    || (severity is not null && !AlertSeverities.Contains(severity))
                    || page is < DefaultPage
                    || limit is < 1 or > MaxLimit)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.GetActiveAlertsAsync(
                    gate.Context!.OrganizationId, module, severity, page ?? DefaultPage, limit ?? DefaultLimit,
                    cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<ActiveAlertsPage>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("MonitoringGetActiveAlerts");

        // 4. getActionPlanAlerts — the ONE row-scoped read: scopeWhereFor('actionPlan') is composed into
        //    the query so a unit/team/own caller only sees plans in their own subject set.
        app.MapGet("/monitoring/action-plan-alerts", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                MonitoringReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await MonitoringStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                ScopePredicate scopeWhere;
                try
                {
                    scopeWhere = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.ActionPlan, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                }
                catch (ScopeAnchorMissingException)
                {
                    // Narrow scope with no anchor loader (org-less privileged caller) — the gate 400s that
                    // case first, but fail CLOSED rather than ever running this read unscoped.
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    if (anchors is IAsyncDisposable disposableAnchors)
                    {
                        await disposableAnchors.DisposeAsync();
                    }
                }

                var result = await useCase.GetActionPlanAlertsAsync(
                    gate.Context!.OrganizationId, scopeWhere, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<ActionPlanAlertsView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("MonitoringGetActionPlanAlerts");

        // 5. getCrossModuleTrend — the engagement metric is k-anon floored ALL-OR-NOTHING across the
        //    window (the monthly-differencing oracle). `metric` is REQUIRED (no Zod default);
        //    `period` defaults to 12m.
        app.MapGet("/monitoring/cross-module-trend", async (
                [FromQuery] string? metric,
                [FromQuery] string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                MonitoringReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await MonitoringStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var resolvedPeriod = period ?? "12m";
                if (metric is null || !TrendMetrics.Contains(metric) || !TrendPeriods.Contains(resolvedPeriod))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.GetCrossModuleTrendAsync(
                    gate.Context!.OrganizationId, metric, resolvedPeriod, cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<CrossModuleTrendView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("MonitoringGetCrossModuleTrend");

        // 6. getAlertRules — every rule in the org, module asc.
        app.MapGet("/monitoring/alert-rules", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                MonitoringReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await MonitoringStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                return Results.Ok(await useCase.GetAlertRulesAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<AlertRuleView>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("MonitoringGetAlertRules");
    }
}
