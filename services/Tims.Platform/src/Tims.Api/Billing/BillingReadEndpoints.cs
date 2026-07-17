using System.Security.Claims;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Billing;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Billing;
using Tims.Domain.Identity;

namespace Tims.Api.Billing;

/// <summary>
/// The billing invoice READ endpoints (Phase-5 Slice 3) — the C# port of <c>billing.listInvoices</c> /
/// <c>billing.getInvoice</c>. This is the FIRST staff-JWT C# PRODUCT surface (all prior C# product
/// endpoints authenticated with the external ApiKey scheme): both are authenticated by the Supabase JWT
/// scheme (<see cref="RequireAuthorization"/>), resolve the TIMS staff principal from the JWT <c>sub</c>
/// (reusing the <c>/require-permission</c> resolution pattern — stash-first, then
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>), and gate on the <c>billing:read</c> grant via the
/// SAME <see cref="PermissionService"/> kernel as the tRPC <c>permissionProcedure('billing','read')</c>.
/// Unresolved principal → 401; denied → 403. The read runs under the resolved org's <c>TenantScope</c>
/// (RLS); billing is org-level, so there is no per-row scope narrowing.
/// </summary>
public static class BillingReadEndpoints
{
    private const string BillingModule = "billing";
    private const string ReadAction = "read";
    private const int DefaultTake = 20;
    private const int MaxTake = 100;

    public static void MapBillingReadEndpoints(this WebApplication app)
    {
        // list — cursor-paginated invoices for the caller's org (full v1 payload; no subscription).
        app.MapGet("/billing/invoices", async (
                int? take,
                string? cursor,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                BillingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var takeValue = take ?? DefaultTake;
                if (takeValue < 1 || takeValue > MaxTake)
                {
                    return Results.BadRequest(new { error = $"take must be between 1 and {MaxTake}" });
                }

                // Strict canonical-UUID parity with Zod `z.string().uuid()`: reject braced / hyphenless /
                // parenthesized forms that Guid.TryParse would accept — only the 8-4-4-4-12 "D" layout.
                if (cursor is not null && !Guid.TryParseExact(cursor, "D", out _))
                {
                    return Results.BadRequest(new { error = "cursor must be a uuid" });
                }

                var gate = await AuthorizeAsync(user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var result = await useCase.ListInvoicesAsync(gate.Context!.OrganizationId, takeValue, cursor, cancellationToken);
                // nextCursor is OMITTED when null (WhenWritingNull on the DTO) — TS returns
                // `nextCursor: undefined` on the last page, which serializes to no key (never `null`).
                return Results.Ok(new InvoiceListResponse(result.Items, result.NextCursor));
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("BillingListInvoices");

        // getInvoice — a single invoice by id (full v1 payload + nested subscription) or 404. The id is
        // taken as a STRING (no `:guid` route constraint) and validated strictly, so a non-UUID id → 400
        // (parity with Zod `z.string().uuid()`), never a route-miss 404.
        app.MapGet("/billing/invoices/{id}", async (
                string id,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                BillingReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                if (!Guid.TryParseExact(id, "D", out _))
                {
                    return Results.BadRequest(new { error = "id must be a uuid" });
                }

                var gate = await AuthorizeAsync(user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                try
                {
                    var v1 = await useCase.GetInvoiceAsync(gate.Context!.OrganizationId, id, cancellationToken);
                    return Results.Ok(v1);
                }
                catch (BillingInvoiceNotFoundException)
                {
                    return Results.NotFound(new { message = BillingInvoiceNotFoundException.NotFoundMessage });
                }
            })
            .RequireAuthorization()
            .Produces<InvoiceDetailV1>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("BillingGetInvoice");
    }

    // Staff-JWT gate (the permissionProcedure('billing','read') analog): resolve the TIMS principal from
    // the JWT `sub` (unresolvable → 401, i.e. `ctx.user === null`), then enforce the billing:read grant
    // via the SAME PermissionService kernel (denied → 403). A privileged, org-less principal on this
    // tenant module raises BAD_REQUEST (400), mirroring the TS kernel / the /require-permission probe.
    private static async Task<StaffGate> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return StaffGate.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        try
        {
            var decision = await permissionService.CheckAsync(context, BillingModule, ReadAction, cancellationToken);
            return decision.Allowed
                ? StaffGate.Ok(context)
                : StaffGate.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }
        catch (TenantOrgRequiredException)
        {
            return StaffGate.Fail(Results.BadRequest(new { error = "organization_required" }));
        }
    }

    // Shared principal resolution (the /require-permission ResolvePrincipalAsync pattern): reuse the
    // principal already resolved by PrincipalResolutionMiddleware (stashed in HttpContext.Items) to avoid
    // a second DB round-trip; fall back to resolving here if absent (staying robust). JWT `sub` →
    // TenantContext (or null when the caller is not resolvable active staff/owner). Honors the
    // platform-owner impersonation cookie + secret.
    private static async Task<TenantContext?> ResolvePrincipalAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolvedPrincipal)
        {
            return resolvedPrincipal.Context;
        }

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
        {
            return null;
        }

        var resolution = await principalResolver.ResolveStaffAsync(
            sub,
            httpContext.Request.Headers.Cookie.ToString(),
            options.ImpersonationSecret,
            DateTime.UtcNow,
            cancellationToken);

        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }

    // The listInvoices envelope: items + an OPTIONAL nextCursor. WhenWritingNull OMITS the key on the last
    // page (TS `nextCursor: undefined` → no key), never emitting `"nextCursor":null`.
    private sealed record InvoiceListResponse(
        IReadOnlyList<InvoiceListItemV1> Items,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        string? NextCursor);

    private readonly struct StaffGate
    {
        private StaffGate(TenantContext? context, IResult? failure)
        {
            Context = context;
            Failure = failure;
        }

        public TenantContext? Context { get; }

        public IResult? Failure { get; }

        public static StaffGate Ok(TenantContext context) => new(context, null);

        public static StaffGate Fail(IResult failure) => new(null, failure);
    }
}
