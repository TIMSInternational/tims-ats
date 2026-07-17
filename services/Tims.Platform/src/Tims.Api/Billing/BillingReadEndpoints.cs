using System.Security.Claims;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Billing;
using Tims.Application.Identity;
using Tims.Domain.Billing;

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

                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    BillingModule, ReadAction, cancellationToken);
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

                var gate = await BillingStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value,
                    BillingModule, ReadAction, cancellationToken);
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

    // The listInvoices envelope: items + an OPTIONAL nextCursor. WhenWritingNull OMITS the key on the last
    // page (TS `nextCursor: undefined` → no key), never emitting `"nextCursor":null`.
    private sealed record InvoiceListResponse(
        IReadOnlyList<InvoiceListItemV1> Items,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        string? NextCursor);
}
