using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.Reporting;
using Tims.Domain.Reporting;

namespace Tims.Api.Reporting;

/// <summary>
/// The recruitment-analytics READ endpoints (Phase-5 Slice 5) — the C# port of the six
/// <c>recruitmentAnalytics.*</c> procedures. All are <c>permissionProcedure('vacancy','read')</c> +
/// <c>requireOrgScope</c>, gated by the shared <see cref="ReportingStaffGate"/> (staff JWT → vacancy:read
/// grant → organization/company scope; unresolved → 401, denied/narrow-scope → 403, org-less privileged →
/// 400). Reads run under the resolved org's <c>TenantScope</c> (RLS) with an explicit org filter. INTERNAL
/// staff read = raw kernel view shape, NO <c>schemaVersion</c>. Dark-by-default behind
/// <see cref="PlatformOptions.ReportingReadEnabled"/> (mapped only when on, or at build-time OpenAPI gen).
/// </summary>
public static class ReportingReadEndpoints
{
    private static readonly HashSet<string> AllowedPeriods = new(StringComparer.Ordinal) { "7D", "30D", "90D", "6M", "1Y" };
    private const string DefaultPeriod = "30D";

    public static void MapReportingReadEndpoints(this WebApplication app)
    {
        // kpis — honestly computable KPI row (period-relative). Invalid period → 400 (Zod enum parity).
        app.MapGet("/reporting/kpis", async (
                string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                ReportingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                // Authorize BEFORE validating input, matching tRPC (the permissionProcedure middleware runs
                // before Zod input parsing) — an unauthenticated bad-period request is 401, not 400.
                var gate = await ReportingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryResolvePeriod(period, out var resolvedPeriod))
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                var kpis = await useCase.GetKpisAsync(gate.Context!.OrganizationId, resolvedPeriod, cancellationToken);
                return Results.Ok(kpis);
            })
            .RequireAuthorization()
            .Produces<KpiView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ReportingGetKpis");

        // funnel — current org-wide funnel (stages merged by name).
        app.MapGet("/reporting/funnel", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                ReportingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await ReportingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var funnel = await useCase.GetFunnelAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(funnel);
            })
            .RequireAuthorization()
            .Produces<FunnelView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ReportingGetFunnel");

        // source-breakdown — applications + hires per source, top 6 (period-relative).
        app.MapGet("/reporting/source-breakdown", async (
                string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                ReportingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await ReportingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryResolvePeriod(period, out var resolvedPeriod))
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                var breakdown = await useCase.GetSourceBreakdownAsync(gate.Context!.OrganizationId, resolvedPeriod, cancellationToken);
                return Results.Ok(breakdown);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<SourceBreakdownItem>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ReportingGetSourceBreakdown");

        // trend — applications per month, last 6 UTC calendar months (oldest-first).
        app.MapGet("/reporting/trend", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                ReportingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await ReportingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var trend = await useCase.GetTrendAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(trend);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<TrendBucket>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ReportingGetTrend");

        // lost-by-delay — candidates rejected while overdue on their stage SLA (period-relative).
        app.MapGet("/reporting/lost-by-delay", async (
                string? period,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                ReportingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await ReportingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryResolvePeriod(period, out var resolvedPeriod))
                {
                    return Results.BadRequest(new { error = "invalid_period" });
                }

                var lost = await useCase.GetLostByDelayAsync(gate.Context!.OrganizationId, resolvedPeriod, cancellationToken);
                return Results.Ok(lost);
            })
            .RequireAuthorization()
            .Produces<LostByDelayView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ReportingGetLostByDelay");

        // recruiter-sla — per-recruiter workload + SLA compliance.
        app.MapGet("/reporting/recruiter-sla", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                ReportingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await ReportingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var rows = await useCase.GetRecruiterSlaAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<RecruiterSlaRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ReportingGetRecruiterSla");
    }

    // period defaults to 30D when absent; an unrecognized value is rejected (Zod z.enum parity).
    private static bool TryResolvePeriod(string? period, out string resolved)
    {
        if (string.IsNullOrEmpty(period))
        {
            resolved = DefaultPeriod;
            return true;
        }

        resolved = period;
        return AllowedPeriods.Contains(period);
    }
}
