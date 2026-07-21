using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Application.TeamIntel;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Domain.TeamIntel;
using Tims.Infrastructure.Access;

namespace Tims.Api.TeamIntel;

/// <summary>
/// The team-intel READ endpoints (Phase-5 Slice 6) — the C# port of the seven <c>teamIntel.*</c>
/// procedures, all <c>permissionProcedure('team_intel','read')</c>, gated by <see cref="TeamIntelStaffGate"/>.
/// This is the FIRST live <c>assertScoped('team')</c> wiring on a READ path:
/// <list type="number">
///   <item><description>1–5 (<c>/team-intel/teams/{teamId}/…</c>): gate → <see cref="ScopedProbe"/> IDOR probe
///     on the team (404-not-403, never confirms the id); 4/5 return 501 AFTER the probe.</description></item>
///   <item><description>6 (<c>/team-intel/compare</c>): gate → <see cref="ScopeWhereFor"/>('team') composed
///     into the query so out-of-scope teamIds silently drop.</description></item>
///   <item><description>7 (<c>/team-intel/dashboard-kpis</c>): gate → <see cref="OrgGate"/> (narrow → 403, F3).</description></item>
/// </list>
/// INTERNAL staff read = raw model / kernel shape, NO <c>schemaVersion</c>. Input validation runs AFTER auth
/// (tRPC parity). Dark-by-default behind <see cref="PlatformOptions.TeamIntelReadEnabled"/> (mapped only when
/// on, or at build-time OpenAPI gen).
/// </summary>
public static class TeamIntelReadEndpoints
{
    private const string TeamNotFoundMessage = "Equipo no encontrado";
    private const string BalanceAlertsNotImplemented =
        "Las alertas de balance con IA aun no estan disponibles (agente pendiente).";
    private const string RecommendedHiresNotImplemented =
        "Las recomendaciones de contratacion con IA aun no estan disponibles (agente pendiente).";

    public static void MapTeamIntelReadEndpoints(this WebApplication app)
    {
        // 1. getTeamProfile — gate → team IDOR probe → org-filtered profile (404 if missing/out-of-scope).
        app.MapGet("/team-intel/teams/{teamId:guid}/profile", async (
                Guid teamId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                TeamIntelReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await TeamIntelStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var probe = await AssertTeamScopeAsync(gate, teamId, anchorLoaderFactory, scopedProbe, cancellationToken);
                if (probe is not null)
                {
                    return probe;
                }

                var profile = await useCase.GetTeamProfileAsync(gate.Context!.OrganizationId, teamId, cancellationToken);
                return profile is null ? Results.NotFound(new { message = TeamNotFoundMessage }) : Results.Ok(profile);
            })
            .RequireAuthorization()
            .Produces<TeamProfileView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("TeamIntelGetTeamProfile");

        // 2. getMembers — gate → probe → membership rows (joinedAt asc).
        app.MapGet("/team-intel/teams/{teamId:guid}/members", async (
                Guid teamId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                TeamIntelReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await TeamIntelStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var probe = await AssertTeamScopeAsync(gate, teamId, anchorLoaderFactory, scopedProbe, cancellationToken);
                if (probe is not null)
                {
                    return probe;
                }

                var members = await useCase.GetMembersAsync(gate.Context!.OrganizationId, teamId, cancellationToken);
                return Results.Ok(members);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<TeamMemberView>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("TeamIntelGetMembers");

        // 3. getBalanceScore — gate → probe → balance kernel (wrapped with teamId).
        app.MapGet("/team-intel/teams/{teamId:guid}/balance-score", async (
                Guid teamId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                TeamIntelReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await TeamIntelStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var probe = await AssertTeamScopeAsync(gate, teamId, anchorLoaderFactory, scopedProbe, cancellationToken);
                if (probe is not null)
                {
                    return probe;
                }

                var balance = await useCase.GetBalanceScoreAsync(gate.Context!.OrganizationId, teamId, cancellationToken);
                return Results.Ok(balance);
            })
            .RequireAuthorization()
            .Produces<BalanceScoreResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("TeamIntelGetBalanceScore");

        // 4. getBalanceAlerts — gate → probe → 501 (honest stub; AI agent pending). The probe runs FIRST so
        //    the teamId-keyed contract leaks nothing when the body is implemented later.
        app.MapGet("/team-intel/teams/{teamId:guid}/balance-alerts", async (
                Guid teamId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                CancellationToken cancellationToken) =>
                await NotImplementedAfterProbeAsync(
                    teamId, user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    anchorLoaderFactory, scopedProbe, BalanceAlertsNotImplemented, cancellationToken))
            .RequireAuthorization()
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status501NotImplemented)
            .WithName("TeamIntelGetBalanceAlerts");

        // 5. getRecommendedHires — gate → probe → 501 (honest stub; AI agent pending).
        app.MapGet("/team-intel/teams/{teamId:guid}/recommended-hires", async (
                Guid teamId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                CancellationToken cancellationToken) =>
                await NotImplementedAfterProbeAsync(
                    teamId, user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    anchorLoaderFactory, scopedProbe, RecommendedHiresNotImplemented, cancellationToken))
            .RequireAuthorization()
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status501NotImplemented)
            .WithName("TeamIntelGetRecommendedHires");

        // 6. compareTeams — gate → scopeWhereFor('team') composed into the query (out-of-scope ids drop).
        //    Input (2..5 uuids) validated AFTER auth (tRPC middleware-before-Zod parity).
        app.MapGet("/team-intel/compare", async (
                [FromQuery(Name = "teamIds")] string[]? teamIds,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                TeamIntelReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await TeamIntelStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (ParseTeamIds(teamIds) is not { } ids)
                {
                    return Results.BadRequest(new { error = "invalid_team_ids" });
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                ScopePredicate scopeWhere;
                try
                {
                    scopeWhere = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.Team, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                }
                catch (ScopeAnchorMissingException)
                {
                    // Narrow scope with no anchor loader (org-less) → FORBIDDEN parity (unreachable here — the
                    // gate 400s an org-less privileged caller — but fail closed rather than run unscoped).
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    if (anchors is IAsyncDisposable disposableAnchors)
                    {
                        await disposableAnchors.DisposeAsync();
                    }
                }

                var comparison = await useCase.GetComparisonAsync(
                    gate.Context!.OrganizationId, scopeWhere, ids, cancellationToken);
                return Results.Ok(comparison);
            })
            .RequireAuthorization()
            .Produces<TeamComparisonView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("TeamIntelCompareTeams");

        // 7. getDashboardKpis — gate → org-rollup gate (narrow team/unit/own → 403, Codex F3) → org counts.
        app.MapGet("/team-intel/dashboard-kpis", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                TeamIntelReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await TeamIntelStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var kpis = await useCase.GetDashboardKpisAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(kpis);
            })
            .RequireAuthorization()
            .Produces<DashboardKpiView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("TeamIntelGetDashboardKpis");
    }

    // The gate → 501 stub path shared by getBalanceAlerts / getRecommendedHires: authorize, run the team IDOR
    // probe (so a narrow caller cannot even confirm the id), THEN return NOT_IMPLEMENTED.
    private static async Task<IResult> NotImplementedAfterProbeAsync(
        Guid teamId,
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        IAnchorLoaderFactory anchorLoaderFactory,
        ScopedProbe scopedProbe,
        string message,
        CancellationToken cancellationToken)
    {
        var gate = await TeamIntelStaffGate.AuthorizeAsync(
            user, httpContext, principalResolver, permissionService, options, cancellationToken);
        if (gate.Failure is not null)
        {
            return gate.Failure;
        }

        var probe = await AssertTeamScopeAsync(gate, teamId, anchorLoaderFactory, scopedProbe, cancellationToken);
        if (probe is not null)
        {
            return probe;
        }

        return Results.Json(new { message }, statusCode: StatusCodes.Status501NotImplemented);
    }

    // The by-id IDOR probe on the team (endpoints 1–5): a narrow-scoped caller must not reach an out-of-scope
    // team by id-guessing → ScopedNotFoundException (404, "Equipo no encontrado"), never confirms the id.
    private static async Task<IResult?> AssertTeamScopeAsync(
        TeamIntelGateResult gate,
        Guid teamId,
        IAnchorLoaderFactory anchorLoaderFactory,
        ScopedProbe scopedProbe,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(gate.Context!.OrganizationId);
        var userId = Guid.Parse(gate.Context!.UserId);
        var anchors = anchorLoaderFactory.Create(orgId, userId);
        try
        {
            await scopedProbe.AssertScopedAsync(
                ScopedEntity.Team, teamId, gate.Scope!.Value, anchors, orgId, userId, cancellationToken);
            return null;
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
    }

    // Zod parity: z.array(z.string().uuid()).min(2).max(5). Null/out-of-range/any-non-uuid → invalid (→ 400).
    private static IReadOnlyList<Guid>? ParseTeamIds(string[]? raw)
    {
        if (raw is null || raw.Length < 2 || raw.Length > 5)
        {
            return null;
        }

        var ids = new List<Guid>(raw.Length);
        foreach (var value in raw)
        {
            if (!Guid.TryParse(value, out var id))
            {
                return null;
            }

            ids.Add(id);
        }

        return ids;
    }
}
