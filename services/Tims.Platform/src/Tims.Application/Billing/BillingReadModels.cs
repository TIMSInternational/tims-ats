using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// A cursor page of raw invoice rows (repository output). <see cref="Rows"/> is already sliced to the
/// requested <c>take</c>; <see cref="NextCursor"/> is the invoice id to resume from (null = last page).
/// List rows carry NO subscription (<see cref="InvoiceRow.Subscription"/> is null → the v1 wire OMITS the
/// key), matching the TS <c>listInvoices</c> (no <c>include</c>).
/// </summary>
public sealed record BillingInvoicePage(
    IReadOnlyList<InvoiceRow> Rows,
    string? NextCursor);

/// <summary>The mapped, cursor-paginated v1 list the list endpoint returns. Items are the LIST wire shape
/// (<see cref="InvoiceListItemV1"/>) — no <c>subscription</c> key (TS <c>listInvoices</c> has no include).</summary>
public sealed record BillingInvoiceListResult(
    IReadOnlyList<InvoiceListItemV1> Items,
    string? NextCursor);
