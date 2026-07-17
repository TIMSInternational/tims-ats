namespace Tims.Application.Billing;

/// <summary>
/// Thrown by <see cref="BillingReadUseCase.GetInvoiceAsync"/> when the invoice id is not present in the
/// caller's org — the port of the TS <c>findFirstOrThrow</c> NOT_FOUND. Cross-org and missing are
/// indistinguishable (IDOR-safe); the caller maps this to a 404.
/// </summary>
public sealed class BillingInvoiceNotFoundException : Exception
{
    public const string NotFoundMessage = "invoice not found";

    public BillingInvoiceNotFoundException()
        : base(NotFoundMessage)
    {
    }
}
