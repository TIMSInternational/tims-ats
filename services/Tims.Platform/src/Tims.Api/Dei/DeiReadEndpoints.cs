using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Dei;
using Tims.Application.Identity;
using Tims.Domain.Dei;

namespace Tims.Api.Dei;

/// <summary>
/// The DEI READ endpoints (Phase-5 Slice 11b — people-dashboards GROUP 2) — the C# port of the TEN ported read
/// procedures of the TS <c>dei</c> router (getPayEquity → Slice 11c; the generateReport mutation is not ported).
/// All are <c>permissionProcedure('dei','read')</c>, gated by the GRANT-ONLY <see cref="DeiStaffGate"/> (no
/// org-gate — the reads are org-wide demographic rollups whose disclosure control is k-anonymity, applied by the
/// pure @tims/shared / Tims.Domain.Dei kernels). INTERNAL reads = raw model / kernel shape, NO <c>schemaVersion</c>.
/// Query-param validation runs AFTER auth (tRPC parity). Dark-by-default behind
/// <see cref="PlatformOptions.DeiReadEnabled"/>.
/// </summary>
public static class DeiReadEndpoints
{
    public static void MapDeiReadEndpoints(this WebApplication app)
    {
        // 1. getDashboardKpis.
        app.MapGet("/dei/dashboard-kpis", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetDashboardKpisAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<DashboardKpis>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetDashboardKpis");

        // 2. getGenderRepresentation.
        app.MapGet("/dei/gender-representation", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetGenderRepresentationAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<GenderRepresentationView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetGenderRepresentation");

        // 3. getAgeDistribution (server-side bucketing with the request clock).
        app.MapGet("/dei/age-distribution", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetAgeDistributionAsync(gate.Context!.OrganizationId, DateTime.UtcNow, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<AgeDistributionView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetAgeDistribution");

        // 4. getNationalityDiversity.
        app.MapGet("/dei/nationality-diversity", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetNationalityDiversityAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<NationalityDiversityView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetNationalityDiversity");

        // 5. getEthnicityDistribution.
        app.MapGet("/dei/ethnicity-distribution", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetEthnicityDistributionAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<EthnicityDistributionView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetEthnicityDistribution");

        // 6. getDisabilityDistribution.
        app.MapGet("/dei/disability-distribution", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetDisabilityDistributionAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<DisabilityDistributionView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetDisabilityDistribution");

        // 8. getLeadershipDiversity.
        app.MapGet("/dei/leadership-diversity", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetLeadershipDiversityAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<LeadershipDiversityResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetLeadershipDiversity");

        // 9. getHiringFunnel({dateFrom?, dateTo?}) — NO suppression (candidates carry no demographics).
        app.MapGet("/dei/hiring-funnel", async (
                [FromQuery(Name = "dateFrom")] string? dateFrom,
                [FromQuery(Name = "dateTo")] string? dateTo,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalDateTime(dateFrom, out var from) || !TryOptionalDateTime(dateTo, out var to))
                {
                    return Results.BadRequest(new { error = "invalid_date" });
                }

                return Results.Ok(await useCase.GetHiringFunnelAsync(gate.Context!.OrganizationId, from, to, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<HiringFunnelView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetHiringFunnel");

        // 10. getPromotionEquity({year?}) — min-5 floored count.
        app.MapGet("/dei/promotion-equity", async (
                [FromQuery(Name = "year")] string? year,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // A present year must be within DateTimeOffset's constructible range (the use-case builds
                // `new DateTimeOffset(year, …)` AND `new DateTimeOffset(year + 1, …)`, so year ≤ 9998) — else it
                // would throw a 500. TS z.number().int() is unbounded but only yields garbage dates, never a crash;
                // we harden to a clean 400 (Codex Slice-11b L2). Absent year → resolved to the current year.
                if (!TryOptionalInt(year, out var parsedYear) || parsedYear is < 1 or > 9998)
                {
                    return Results.BadRequest(new { error = "invalid_year" });
                }

                var resolvedYear = parsedYear ?? DateTime.UtcNow.Year;
                return Results.Ok(await useCase.GetPromotionEquityAsync(gate.Context!.OrganizationId, resolvedYear, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<PromotionEquityView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetPromotionEquity");

        // 11. getInclusionIndex({surveyId?}) — climate-survey multi-tier suppression.
        app.MapGet("/dei/inclusion-index", async (
                [FromQuery(Name = "surveyId")] string? surveyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!TryOptionalUuid(surveyId, out var sid))
                {
                    return Results.BadRequest(new { error = "invalid_survey_id" });
                }

                return Results.Ok(await useCase.GetInclusionIndexAsync(gate.Context!.OrganizationId, sid, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<InclusionIndexResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetInclusionIndex");
    }

    // Optional ISO-8601 datetime (TS z.string().datetime().optional()): omitted → null (no filter); a PRESENT value
    // must parse as a timezone-qualified instant, else 400.
    private static bool TryOptionalDateTime(string? value, out DateTimeOffset? parsed)
    {
        if (value is null)
        {
            parsed = null;
            return true;
        }

        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dto))
        {
            parsed = dto;
            return true;
        }

        parsed = null;
        return false;
    }

    // Optional integer (TS z.number().int().optional()): omitted → null; a PRESENT value must parse as an int.
    private static bool TryOptionalInt(string? value, out int? parsed)
    {
        if (value is null)
        {
            parsed = null;
            return true;
        }

        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i))
        {
            parsed = i;
            return true;
        }

        parsed = null;
        return false;
    }

    // Optional uuid (TS z.string().uuid().optional()): omitted → null; a PRESENT value must parse as a uuid.
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

    /// <summary>
    /// Maps <c>GET /dei/pay-equity</c> (Slice 11c, FX) — SEPARATE from the 11b reads because it is gated by
    /// <see cref="PlatformOptions.FxReadsEnabled"/>, not <see cref="PlatformOptions.DeiReadEnabled"/> (its FX
    /// dependency canaries on its own flag). Same GRANT-ONLY <see cref="DeiStaffGate"/> as the other dei reads.
    /// FAIL-SOFT cold-start (a missing pin) → suppressed:true empty results, never a 500.
    /// </summary>
    public static void MapDeiPayEquityEndpoint(this WebApplication app)
    {
        app.MapGet("/dei/pay-equity", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                DeiReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await DeiStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                return gate.Failure
                    ?? Results.Ok(await useCase.GetPayEquityAsync(gate.Context!.OrganizationId, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<PayEquityView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DeiGetPayEquity");
    }
}
