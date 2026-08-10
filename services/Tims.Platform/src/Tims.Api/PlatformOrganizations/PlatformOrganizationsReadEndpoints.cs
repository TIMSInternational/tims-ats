using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.PlatformOrganizations;

namespace Tims.Api.PlatformOrganizations;

/// <summary>
/// The platform-owner organizations READ endpoints (Phase-5 slice 19, issue #76) — the C# port of the
/// THREE read procedures in <c>routers/platform/organizations.ts</c>.
///
/// <para><b>Gate: <see cref="PlatformOwnerGate"/>, reused not re-implemented.</b> It is documented as
/// the C# analog of the TS <c>platformProcedure</c> and already handles the case a fresh gate would get
/// wrong: an impersonated platform-owner session resolves to <c>PrincipalType.OrgUser</c>, so it is
/// denied without special-case code — matching TS's <c>ctx.user.isPlatformOwner</c> check against the
/// real, non-impersonated row.</para>
///
/// <para><b>There is no second line of defence.</b> This surface is deliberately cross-org and is never
/// wrapped in <c>TenantScope</c>, so RLS restricts nothing here (and the prod role is BYPASSRLS
/// regardless). The gate IS the authorization boundary — which is why it runs first on every endpoint,
/// before input validation, mirroring tRPC's middleware-before-Zod order.</para>
///
/// <para><b>The three WRITES are deliberately not here.</b> <c>createOrganization</c>,
/// <c>updateOrganization</c> and <c>suspendOrganization</c> belong to a separate write slice: the
/// Phase-5 recipe routes reads first, and the writes would move <c>organizations</c> and
/// <c>subscriptions</c> into <c>efcoreStranglerWrite</c>, which needs its own one-active-writer flag
/// discipline rather than riding a read flag. Every domain in this repo is split the same way
/// (external-vendor 1/2, billing 3/4, engagement 11/16).</para>
///
/// INTERNAL staff read ⇒ RAW procedure shape, NO <c>schemaVersion</c> envelope. Dark-by-default behind
/// <see cref="PlatformOptions.PlatformOrganizationsReadEnabled"/>.
/// </summary>
public static class PlatformOrganizationsReadEndpoints
{
    public static void MapPlatformOrganizationsReadEndpoints(this WebApplication app)
    {
        app.MapGet(
                "/platform/organizations/kpis",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformOrganizationsReadUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetKpisAsync(cancellationToken));
                })
            .AllowAnonymous()
            .WithName("GetPlatformOrganizationKpis")
            .WithTags("PlatformOrganizations");

        app.MapGet(
                "/platform/organizations",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformOrganizationsReadUseCase useCase,
                    CancellationToken cancellationToken,
                    [FromQuery] Guid? cursor = null,
                    [FromQuery] int page = PlatformOrganizationsReadUseCase.DefaultPage,
                    [FromQuery] int limit = PlatformOrganizationsReadUseCase.DefaultLimit,
                    [FromQuery] string? search = null,
                    [FromQuery] string? plan = null,
                    [FromQuery] string? status = null,
                    [FromQuery] string? sortBy = null,
                    [FromQuery] string? sortDir = null) =>
                {
                    // Auth BEFORE validation — tRPC runs middleware before Zod, so a non-owner sending
                    // bad input must get 403, not 400. Getting this backwards leaks the existence of
                    // validation rules to unauthenticated callers.
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    // Zod bounds from organizations.ts:32-41. Rejecting (not clamping) is the parity
                    // behaviour: tRPC would throw BAD_REQUEST.
                    if (page < 0
                        || limit < PlatformOrganizationsReadUseCase.MinLimit
                        || limit > PlatformOrganizationsReadUseCase.MaxLimit
                        || search?.Length > PlatformOrganizationsReadUseCase.MaxSearchLength
                        || plan?.Length > PlatformOrganizationsReadUseCase.MaxPlanLength
                        || status?.Length > PlatformOrganizationsReadUseCase.MaxStatusLength
                        || !PlatformOrganizationsReadUseCase.IsValidSortBy(sortBy)
                        || !PlatformOrganizationsReadUseCase.IsValidSortDir(sortDir))
                    {
                        return Results.BadRequest();
                    }

                    var query = new PlatformOrganizationListQuery(cursor, page, limit, search, plan, status, sortBy, sortDir);
                    return Results.Ok(await useCase.ListAsync(query, cancellationToken));
                })
            .AllowAnonymous()
            .WithName("ListPlatformOrganizations")
            .WithTags("PlatformOrganizations");

        app.MapGet(
                "/platform/organizations/{id:guid}",
                async (
                    Guid id,
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformOrganizationsReadUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    var detail = await useCase.GetByIdAsync(id, cancellationToken);

                    // TS throws TRPCError NOT_FOUND (organizations.ts:100).
                    return detail is null ? Results.NotFound() : Results.Ok(detail);
                })
            .AllowAnonymous()
            .WithName("GetPlatformOrganization")
            .WithTags("PlatformOrganizations");
    }
}
