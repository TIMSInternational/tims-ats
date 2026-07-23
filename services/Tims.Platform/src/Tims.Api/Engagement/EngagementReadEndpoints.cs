using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Engagement;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Engagement;
using Tims.Infrastructure.Access;

namespace Tims.Api.Engagement;

/// <summary>
/// The engagement READ endpoints (Phase-5 Slice 11) — the C# port of the FOURTEEN read procedures of the TS
/// <c>engagement</c> router (the five writes are NOT ported). All are <c>permissionProcedure('engagement','read')</c>,
/// gated by <see cref="EngagementStaffGate"/>, which returns the resolved scope so each endpoint applies its OWN
/// mechanic:
/// <list type="bullet">
///   <item><description>grant-only + per-item min-5 k-anon: listSurveys.</description></item>
///   <item><description>OWN identity-anchored, NO org-gate: myPendingSurveys, getSurveyForResponse.</description></item>
///   <item><description><c>requireOrgScope</c> (org-rollup, narrow → 403): getSurveyResults, getEnps,
///     getClimateHeatmap, getResultsByArea, getWordCloud, getSentiment, getLowClimateAlerts, getDashboardKpis,
///     getRotationRisk.</description></item>
///   <item><description><c>scopeWhereFor</c> (row filter): listActionPlans, listLeaderCommitments.</description></item>
/// </list>
/// INTERNAL reads = raw model / kernel shape, NO <c>schemaVersion</c>. Query-param validation runs AFTER auth (tRPC
/// parity). Dark-by-default behind <see cref="PlatformOptions.EngagementReadEnabled"/>.
/// </summary>
public static class EngagementReadEndpoints
{
    private const string SurveyNotFound = "Encuesta no encontrada";
    private const string SurveyUnavailable = "Encuesta no encontrada o no disponible";

    private static readonly string[] SurveyStatuses = { "draft", "active", "closed" };
    private static readonly string[] EnpsPeriods = { "month", "quarter", "year" };
    private static readonly string[] AreaGroupBys = { "company", "businessUnit", "team" };
    private static readonly string[] ActionPlanStatuses = { "open", "in_progress", "completed", "pending" };
    private static readonly string[] LeaderCommitmentStatuses = { "pending", "fulfilled", "overdue" };

    public static void MapEngagementReadEndpoints(this WebApplication app)
    {
        // 1. listSurveys — gate only (grant) + per-item min-5 responseCount floor. NO org-gate.
        app.MapGet("/engagement/surveys", async (
                [FromQuery(Name = "status")] string? status,
                [FromQuery(Name = "page")] int? page,
                [FromQuery(Name = "limit")] int? limit,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalEnum(status, SurveyStatuses, out var validStatus))
                {
                    return Results.BadRequest(new { error = "invalid_status" });
                }

                var resolvedPage = page ?? 1;
                var resolvedLimit = limit ?? 20;
                if (resolvedPage < 1 || resolvedLimit < 1 || resolvedLimit > 100)
                {
                    return Results.BadRequest(new { error = "invalid_pagination" });
                }

                var view = await useCase.ListSurveysAsync(
                    gate.Context!.OrganizationId, validStatus, resolvedPage, resolvedLimit, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<SurveyListView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementListSurveys");

        // 2. getSurveyResults — gate → requireOrgScope → summarizeSurveyResults. Missing → 500 (TS plain Error).
        app.MapGet("/engagement/surveys/{surveyId:guid}/results", async (
                Guid surveyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var view = await useCase.GetSurveyResultsAsync(gate.Context!.OrganizationId, surveyId, cancellationToken);
                return view is null ? SurveyNotFoundError() : Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<SurveyResultsView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status500InternalServerError)
            .WithName("EngagementGetSurveyResults");

        // 3. myPendingSurveys — gate only (OWN self-service). NO org-gate (it would forbid the own-scoped caller).
        app.MapGet("/engagement/my/pending-surveys", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var view = await useCase.MyPendingSurveysAsync(
                    gate.Context!.OrganizationId, Guid.Parse(gate.Context!.UserId), DateTimeOffset.UtcNow, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<PendingSurveyRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementMyPendingSurveys");

        // 4. getSurveyForResponse — gate only (OWN self-service). NO org-gate. Out-of-window/cross-org → 404.
        app.MapGet("/engagement/surveys/{surveyId:guid}/take", async (
                Guid surveyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var view = await useCase.GetSurveyForResponseAsync(
                    gate.Context!.OrganizationId, surveyId, DateTimeOffset.UtcNow, cancellationToken);
                return view is null ? Results.NotFound(new { message = SurveyUnavailable }) : Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<SurveyForResponseView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("EngagementGetSurveyForResponse");

        // 5. getEnps — gate → requireOrgScope → computeEnps. companyId is accepted but (per TS) unused.
        app.MapGet("/engagement/enps", async (
                [FromQuery(Name = "period")] string? period,
                [FromQuery(Name = "companyId")] string? companyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var resolvedPeriod = period ?? "quarter";
                if (!EnpsPeriods.Contains(resolvedPeriod) || !TryOptionalUuid(companyId, out _))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var since = EnpsSince(resolvedPeriod, DateTimeOffset.UtcNow);
                var view = await useCase.GetEnpsAsync(gate.Context!.OrganizationId, since, resolvedPeriod, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<EnpsResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementGetEnps");

        // 6. getClimateHeatmap — gate → requireOrgScope → buildClimateHeatmap (optional surveyId).
        app.MapGet("/engagement/climate-heatmap", async (
                [FromQuery(Name = "surveyId")] string? surveyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalUuid(surveyId, out var sid))
                {
                    return Results.BadRequest(new { error = "invalid_survey_id" });
                }

                var view = await useCase.GetClimateHeatmapAsync(gate.Context!.OrganizationId, sid, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<ClimateHeatmapView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementGetClimateHeatmap");

        // 7. getResultsByArea — gate → requireOrgScope → buildResultsByArea. Missing survey → 500 (TS plain Error).
        app.MapGet("/engagement/surveys/{surveyId:guid}/results-by-area", async (
                Guid surveyId,
                [FromQuery(Name = "groupBy")] string? groupBy,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var resolvedGroupBy = groupBy ?? "company";
                if (!AreaGroupBys.Contains(resolvedGroupBy))
                {
                    return Results.BadRequest(new { error = "invalid_group_by" });
                }

                var view = await useCase.GetResultsByAreaAsync(
                    gate.Context!.OrganizationId, surveyId, resolvedGroupBy, cancellationToken);
                return view is null ? SurveyNotFoundError() : Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<ResultsByAreaView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status500InternalServerError)
            .WithName("EngagementGetResultsByArea");

        // 8. getWordCloud — gate → requireOrgScope → stub { words: [] }.
        app.MapGet("/engagement/surveys/{surveyId:guid}/word-cloud", async (
                Guid surveyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure ?? Results.Ok(new WordCloudView(Array.Empty<WordWeight>()));
            })
            .RequireAuthorization()
            .Produces<WordCloudView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementGetWordCloud");

        // 9. getSentiment — gate → requireOrgScope → stub { positive, neutral, negative, highlights: [] }.
        app.MapGet("/engagement/surveys/{surveyId:guid}/sentiment", async (
                Guid surveyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure ?? Results.Ok(new SentimentView(0, 0, 0, Array.Empty<string>()));
            })
            .RequireAuthorization()
            .Produces<SentimentView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementGetSentiment");

        // 10. getLowClimateAlerts — gate → requireOrgScope → module='engagement' active alerts.
        app.MapGet("/engagement/alerts", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var view = await useCase.GetLowClimateAlertsAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<AlertRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementGetLowClimateAlerts");

        // 11. listActionPlans — gate → scopeWhereFor('actionPlan') row filter.
        app.MapGet("/engagement/action-plans", async (
                [FromQuery(Name = "status")] string? status,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalEnum(status, ActionPlanStatuses, out var validStatus))
                {
                    return Results.BadRequest(new { error = "invalid_status" });
                }

                return await WithScopeAsync(
                    anchorLoaderFactory, gate, ScopedEntity.ActionPlan, cancellationToken,
                    scope => useCase.ListActionPlansAsync(gate.Context!.OrganizationId, validStatus, scope, cancellationToken),
                    Results.Ok);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<ActionPlanRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementListActionPlans");

        // 12. listLeaderCommitments — gate → scopeWhereFor('leaderCommitment') row filter.
        app.MapGet("/engagement/leader-commitments", async (
                [FromQuery(Name = "leaderId")] string? leaderId,
                [FromQuery(Name = "status")] string? status,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await EngagementStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalUuid(leaderId, out var leader)
                    || !TryOptionalEnum(status, LeaderCommitmentStatuses, out var validStatus))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                return await WithScopeAsync(
                    anchorLoaderFactory, gate, ScopedEntity.LeaderCommitment, cancellationToken,
                    scope => useCase.ListLeaderCommitmentsAsync(gate.Context!.OrganizationId, leader, validStatus, scope, cancellationToken),
                    Results.Ok);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<LeaderCommitmentRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementListLeaderCommitments");

        // 13. getDashboardKpis — gate → requireOrgScope → buildEngagementKpis (org total + differencing guard).
        app.MapGet("/engagement/dashboard-kpis", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var view = await useCase.GetDashboardKpisAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<EngagementKpis>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementGetDashboardKpis");

        // 14. getRotationRisk — gate → requireOrgScope → active user count (mostly stub).
        app.MapGet("/engagement/rotation-risk", async (
                [FromQuery(Name = "companyId")] string? companyId,
                [FromQuery(Name = "businessUnitId")] string? businessUnitId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                EngagementReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalUuid(companyId, out var company) || !TryOptionalUuid(businessUnitId, out var unit))
                {
                    return Results.BadRequest(new { error = "invalid_filters" });
                }

                var view = await useCase.GetRotationRiskAsync(gate.Context!.OrganizationId, company, unit, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<RotationRiskView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("EngagementGetRotationRisk");
    }

    // The org-rollup gate (the 9 aggregate reads): the staff gate THEN requireOrgScope (narrow → 403).
    private static async Task<EngagementGateResult> AuthorizeOrgRollupAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var gate = await EngagementStaffGate.AuthorizeAsync(
            user, httpContext, principalResolver, permissionService, options, cancellationToken);
        if (gate.Failure is not null)
        {
            return gate;
        }

        return OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value)
            ? gate
            : EngagementGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
    }

    // scopeWhereFor row-filter reads (listActionPlans / listLeaderCommitments): build the caller's anchor loader,
    // resolve the ScopePredicate (org/company → MatchAll; narrow → the subject-field row filter; org-less narrow →
    // ScopeAnchorMissingException → 403), run the loader, and dispose the anchors.
    private static async Task<IResult> WithScopeAsync<T>(
        IAnchorLoaderFactory anchorLoaderFactory,
        EngagementGateResult gate,
        ScopedEntity entity,
        CancellationToken cancellationToken,
        Func<ScopePredicate, Task<T>> load,
        Func<T, IResult> ok)
    {
        var orgId = Guid.Parse(gate.Context!.OrganizationId);
        var userId = Guid.Parse(gate.Context!.UserId);
        var anchors = anchorLoaderFactory.Create(orgId, userId);
        try
        {
            var scope = await ScopeWhereFor.BuildAsync(entity, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
            return ok(await load(scope));
        }
        catch (ScopeAnchorMissingException)
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }
        finally
        {
            if (anchors is IAsyncDisposable disposable)
            {
                await disposable.DisposeAsync();
            }
        }
    }

    // getSurveyResults / getResultsByArea: the TS throws a plain `new Error('Encuesta no encontrada')` → tRPC
    // INTERNAL_SERVER_ERROR (500). Preserved verbatim (NOT "improved" to 404) — faithful parity; a 500 leaks no
    // existence (cross-org and truly-missing are indistinguishable).
    private static IResult SurveyNotFoundError() =>
        Results.Json(new { message = SurveyNotFound }, statusCode: StatusCodes.Status500InternalServerError);

    // Optional enum (TS z.enum([...]).optional()): absent → null (no filter); a present value must be in the set,
    // else 400. Mirrors Zod rejecting a present out-of-enum value.
    private static bool TryOptionalEnum(string? value, string[] allowed, out string? result)
    {
        if (value is null)
        {
            result = null;
            return true;
        }

        if (allowed.Contains(value))
        {
            result = value;
            return true;
        }

        result = null;
        return false;
    }

    // Optional uuid (TS z.string().uuid().optional()): omitted (null) → valid, no filter; a PRESENT value must
    // parse as a uuid (an empty "?x=" or non-uuid is present-but-invalid → 400).
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

    // getEnps window: month → −1 month, quarter → −3 months, year → −1 year (mirrors the TS setMonth/setFullYear).
    private static DateTimeOffset EnpsSince(string period, DateTimeOffset now) => period switch
    {
        "month" => now.AddMonths(-1),
        "year" => now.AddYears(-1),
        _ => now.AddMonths(-3), // quarter (default)
    };
}
