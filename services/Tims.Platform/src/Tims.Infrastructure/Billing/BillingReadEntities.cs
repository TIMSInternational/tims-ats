namespace Tims.Infrastructure.Billing;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED <c>invoices</c> table (efcoreReadOnly in
/// docs/architecture/table-ownership.md). Maps the FULL model (the TS <c>listInvoices</c>/<c>getInvoice</c>
/// have no <c>select</c>, so the whole row is the contract). Money is Prisma <c>Float</c> → <c>double</c>
/// (never decimal — reproduce the existing model). The <c>status</c> column is the native Prisma
/// <c>InvoiceStatus</c> enum, read into a C# string. Never written: every query is <c>AsNoTracking()</c>
/// and <c>SaveChanges</c> is never called. Run UNDER <c>TenantScope</c> (app_tenant + org GUC) so RLS
/// isolates the org.
/// </summary>
public sealed class InvoiceReadEntity
{
    public Guid Id { get; set; }

    public int InvoiceNumber { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid? SubscriptionId { get; set; }

    public string? StripeInvoiceId { get; set; }

    public double Amount { get; set; }

    public double? Subtotal { get; set; }

    public double? TaxRate { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public string? Description { get; set; }

    public DateTime InvoiceDate { get; set; }

    public DateTime? DueDate { get; set; }

    public string? PoNumber { get; set; }

    public string? Notes { get; set; }

    public string? Memo { get; set; }

    public string? EmailTo { get; set; }

    public string? EmailCc { get; set; }

    public DateTime? PaidAt { get; set; }

    public string? InvoiceUrl { get; set; }

    public DateTime? PeriodStart { get; set; }

    public DateTime? PeriodEnd { get; set; }

    public DateTime CreatedAt { get; set; }

    /// <summary>Nullable to-one subscription (nullable FK → LEFT join; populated only by getInvoice).</summary>
    public SubscriptionReadEntity? Subscription { get; set; }
}

/// <summary>
/// READ-ONLY mapping of the Prisma-OWNED <c>subscriptions</c> table (efcoreReadOnly). Full-model
/// reproduction (nested in getInvoice's <c>include: { subscription: true }</c>). The <c>plan</c>
/// (<c>OrgPlan</c>) and <c>status</c> (<c>SubscriptionStatus</c>) columns are native Prisma enums, read
/// into C# strings. Read-only, run UNDER <c>TenantScope</c>.
/// </summary>
public sealed class SubscriptionReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string? StripeCustomerId { get; set; }

    public string? StripeSubscriptionId { get; set; }

    public string Plan { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public DateTime? CurrentPeriodStart { get; set; }

    public DateTime? CurrentPeriodEnd { get; set; }

    public DateTime? TrialEndsAt { get; set; }

    public DateTime? CancelledAt { get; set; }

    public DateTime? LastStripeEventAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
