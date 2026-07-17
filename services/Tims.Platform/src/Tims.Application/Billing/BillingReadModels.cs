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

/// <summary>
/// The inputs to <c>buildUsageView</c> gathered by the repository for <c>getUsage</c>: the subscription's
/// plan/status/period (all nullable — a missing subscription yields all null → trial limits) plus the three
/// real org-scoped counts. <see cref="PeriodStart"/>/<see cref="PeriodEnd"/> are the instants echoed on the
/// wire; the assessments count was already period-gated by <see cref="PeriodStart"/> in the repository.
/// </summary>
public sealed record BillingUsageData(
    string? Plan,
    string? Status,
    DateTimeOffset? PeriodStart,
    DateTimeOffset? PeriodEnd,
    int Employees,
    int Vacancies,
    int Assessments);
