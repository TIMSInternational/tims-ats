using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Billing;
using Tims.Application.Identity;
using Tims.Domain.Billing;

namespace Tims.Api.Billing;

/// <summary>
/// The billing usage/plan/config READ endpoints (Phase-5 Slice 3b) — the C# port of
/// <c>billing.getUsage</c> / <c>getCurrentPlan</c> / <c>getBillingConfig</c>. All three are
/// <c>permissionProcedure('billing','read')</c>, so they gate identically to the Slice-3 invoice reads via
/// the shared <see cref="BillingStaffGate"/> (staff JWT → <c>billing:read</c> grant; unresolved → 401,
/// denied → 403, org-less privileged → 400). Reads run under the resolved org's <c>TenantScope</c> (RLS);
/// billing is org-level (no per-row scope narrowing). Dark-by-default behind
/// <see cref="PlatformOptions.BillingUsageEnabled"/> (mapped only when on, or at build-time OpenAPI gen).
/// </summary>
public static class BillingUsageEndpoints
{
    private const string BillingModule = "billing";
    private const string ReadAction = "read";

    public static void MapBillingUsageEndpoints(this WebApplication app)
    {
        // usage — real org-scoped counts + entitled-plan limits (honest null storage/apiCalls).
        app.MapGet("/billing/usage", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                BillingUsageUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    BillingModule, ReadAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var usage = await useCase.GetUsageAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(usage);
            })
            .RequireAuthorization()
            .Produces<UsageV1>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("BillingGetUsage");

        // plan — the org's raw Subscription row (full model) or top-level null (findUnique parity).
        app.MapGet("/billing/plan", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                BillingUsageUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    BillingModule, ReadAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var plan = await useCase.GetCurrentPlanAsync(gate.Context!.OrganizationId, cancellationToken);
                // Results.Json serializes a null as the JSON literal `null` (200) — matching the TS
                // findUnique returning `null` when the org has no subscription (never an empty body).
                return Results.Json(plan);
            })
            .RequireAuthorization()
            .Produces<SubscriptionV1>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("BillingGetCurrentPlan");

        // config — whether Stripe self-serve billing is configured for THIS deploy (config-presence gate).
        app.MapGet("/billing/config", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IOptions<StripeBillingOptions> stripeOptions,
                CancellationToken cancellationToken) =>
            {
                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    BillingModule, ReadAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var stripe = stripeOptions.Value;
                var config = BillingUsageUseCase.GetBillingConfig(
                    stripe.SecretKey, stripe.PriceStarter, stripe.PriceProfessional);
                return Results.Ok(config);
            })
            .RequireAuthorization()
            .Produces<BillingConfigV1>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("BillingGetConfig");
    }
}
