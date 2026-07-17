using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// The billing invoice READ use case — infra-free orchestration (drives the repository port only). A
/// faithful port of the TS <c>billing.listInvoices</c> / <c>billing.getInvoice</c> procedures:
///
///   list → query (org-scoped, cursor-paginated) → map each raw row to <see cref="InvoiceListItemV1"/>.
///   getInvoice → query by id+org (subscription LEFT-joined) → map, or throw
///                <see cref="BillingInvoiceNotFoundException"/> (the findFirstOrThrow NOT_FOUND).
///
/// Billing is org-level: no per-row scope narrowing and (unlike the external export surface) no audit —
/// faithfully reproducing the TS procedures, which neither narrow nor audit these reads.
/// </summary>
public sealed class BillingReadUseCase(IBillingReadRepository repository)
{
    private readonly IBillingReadRepository _repository = repository;

    public async Task<BillingInvoiceListResult> ListInvoicesAsync(
        string organizationId, int take, string? cursor, CancellationToken cancellationToken)
    {
        var page = await _repository
            .ListInvoicesAsync(organizationId, take, cursor, cancellationToken)
            .ConfigureAwait(false);

        var items = page.Rows.Select(InvoiceV1Mapper.MapListItem).ToList();
        return new BillingInvoiceListResult(items, page.NextCursor);
    }

    public async Task<InvoiceDetailV1> GetInvoiceAsync(
        string organizationId, string invoiceId, CancellationToken cancellationToken)
    {
        var row = await _repository
            .GetInvoiceAsync(organizationId, invoiceId, cancellationToken)
            .ConfigureAwait(false);

        return row is null
            ? throw new BillingInvoiceNotFoundException()
            : InvoiceV1Mapper.MapDetail(row);
    }
}
