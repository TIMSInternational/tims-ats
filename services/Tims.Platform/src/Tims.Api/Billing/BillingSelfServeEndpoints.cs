using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Billing;
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Api.Billing;

/// <summary>
/// The tenant self-serve billing WRITE endpoints (Phase-5 Slice 4b) — the C# port of the <c>billing</c> router
/// mutations (createCheckoutSession / createPortalSession / cancelSubscription). Staff-JWT authenticated and
/// gated on the <c>billing:update</c> grant via the SAME <see cref="BillingStaffGate"/> as the billing reads
/// (billing:read); every operation runs against the resolved principal's org (impersonation switches org). The
/// action is attributed to the REAL operator (impersonator when impersonating). Dark-by-default: mapped only
/// when <c>Platform:BillingSelfServeEnabled</c> is on (or at build-time OpenAPI generation).
/// </summary>
public static class BillingSelfServeEndpoints
{
    private const string BillingModule = "billing";
    private const string UpdateAction = "update";

    public static void MapBillingSelfServeEndpoints(this WebApplication app)
    {
        // createCheckoutSession — { plan } → { url } (409 when an existing billing relationship blocks a second checkout).
        app.MapPost("/billing/checkout-session", async (
                CheckoutSessionBody? body,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> options,
                BillingSelfServeUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, options.Value, BillingModule, UpdateAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // Validate the plan at the boundary (the C# analog of the TS z.enum(CHECKOUT_PLANS)): a missing
                // body or an unknown plan is a 400 BAD_REQUEST, not a 412 (and never a null-deref 500).
                if (body?.Plan is not ("starter" or "professional"))
                {
                    return Results.BadRequest(new { error = "invalid_plan" });
                }

                try
                {
                    var url = await useCase.CreateCheckoutSessionAsync(gate.Context!.OrganizationId, body.Plan, cancellationToken);
                    return Results.Ok(new { url });
                }
                catch (BillingSelfServeException ex)
                {
                    return Results.Json(new { message = ex.Message }, statusCode: ex.StatusCode);
                }
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .Produces(StatusCodes.Status412PreconditionFailed)
            .Produces(StatusCodes.Status500InternalServerError)
            .WithName("BillingCreateCheckoutSession");

        // createPortalSession — → { url }. Audited (fail-soft).
        app.MapPost("/billing/portal-session", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> options,
                BillingSelfServeUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, options.Value, BillingModule, UpdateAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                try
                {
                    var url = await useCase.CreatePortalSessionAsync(gate.Context!.OrganizationId, ActorFrom(gate.Context), cancellationToken);
                    return Results.Ok(new { url });
                }
                catch (BillingSelfServeException ex)
                {
                    return Results.Json(new { message = ex.Message }, statusCode: ex.StatusCode);
                }
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status412PreconditionFailed)
            .WithName("BillingCreatePortalSession");

        // cancelSubscription — → { cancelAtPeriodEnd: true }. Period-end only (no local flip). Audited (fail-soft).
        app.MapPost("/billing/cancel-subscription", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> options,
                BillingSelfServeUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, options.Value, BillingModule, UpdateAction, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                try
                {
                    await useCase.CancelSubscriptionAsync(gate.Context!.OrganizationId, ActorFrom(gate.Context), cancellationToken);
                    return Results.Ok(new { cancelAtPeriodEnd = true });
                }
                catch (BillingSelfServeException ex)
                {
                    return Results.Json(new { message = ex.Message }, statusCode: ex.StatusCode);
                }
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status412PreconditionFailed)
            .WithName("BillingCancelSubscription");
    }

    // Attribute to the real operator; carry the impersonated (target) account so it is recorded, never
    // misattributed (mirrors the TS auditActor: impersonator id + impersonated account in metadata).
    private static BillingAuditActor ActorFrom(TenantContext context) =>
        context.ImpersonatedBy is not null
            ? new BillingAuditActor(context.ImpersonatedBy, context.UserId)
            : new BillingAuditActor(context.UserId, ImpersonatedUserId: null);
}

/// <summary>The checkout request body: the self-serve <c>plan</c> to subscribe to (starter / professional).</summary>
public sealed record CheckoutSessionBody(string Plan);
