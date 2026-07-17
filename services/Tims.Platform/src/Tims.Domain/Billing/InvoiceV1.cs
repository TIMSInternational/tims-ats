using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Billing;

/// <summary>
/// The raw <c>Invoice</c> row the repository returns (the input to the v1 mapper) — a faithful mirror of
/// the Prisma <c>Invoice</c> model (billing.prisma). Money is <c>Float</c> in Prisma, so it is carried as
/// <see cref="double"/>/<see cref="double"/>? (NOT decimal — reproduce the existing model faithfully); the
/// <c>InvoiceStatus</c> enum crosses as its DB string; every <c>DateTime?</c> is an instant. The nested
/// <see cref="Subscription"/> is populated by <c>getInvoice</c> (Prisma <c>include: { subscription: true }</c>)
/// and <c>null</c> for list rows (no include).
/// </summary>
public sealed record InvoiceRow(
    string Id,
    int InvoiceNumber,
    string OrganizationId,
    string? SubscriptionId,
    string? StripeInvoiceId,
    double Amount,
    double? Subtotal,
    double? TaxRate,
    string Currency,
    string Status,
    string? Description,
    DateTimeOffset InvoiceDate,
    DateTimeOffset? DueDate,
    string? PoNumber,
    string? Notes,
    string? Memo,
    string? EmailTo,
    string? EmailCc,
    DateTimeOffset? PaidAt,
    string? InvoiceUrl,
    DateTimeOffset? PeriodStart,
    DateTimeOffset? PeriodEnd,
    DateTimeOffset CreatedAt,
    SubscriptionRow? Subscription);

/// <summary>
/// The shared, full-shape invoice wire fields — a faithful reproduction of the RAW Prisma <c>Invoice</c>
/// model as the TS billing router returns it (<c>listInvoices</c>/<c>getInvoice</c> have no <c>select</c>,
/// so the wire contract is the FULL model). Money stays a JSON number (<c>Float</c>); the
/// <c>InvoiceStatus</c> enum crosses as its DB string; every date is serialized through the shared Node-ISO
/// converter (<c>…fffZ</c>). Declared ONCE here (DRY, with its date converters); the two concrete wire
/// shapes derive from it.
///
/// There is NO <c>schemaVersion</c>: the live TS router returns the raw Prisma row (findMany /
/// findFirstOrThrow, no mapper) which carries no such field — stamping one was a parity break.
/// </summary>
public abstract record InvoiceWireV1(
    string Id,
    int InvoiceNumber,
    string OrganizationId,
    string? SubscriptionId,
    string? StripeInvoiceId,
    double Amount,
    double? Subtotal,
    double? TaxRate,
    string Currency,
    string Status,
    string? Description,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset InvoiceDate,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? DueDate,
    string? PoNumber,
    string? Notes,
    string? Memo,
    string? EmailTo,
    string? EmailCc,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? PaidAt,
    string? InvoiceUrl,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? PeriodStart,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? PeriodEnd,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset CreatedAt);

/// <summary>
/// The <c>listInvoices</c> wire item. TS <c>listInvoices</c> has NO <c>include</c>, so its rows carry NO
/// <c>subscription</c> key at all — reproduced here by simply NOT declaring the property (the key can
/// never appear).
/// </summary>
public sealed record InvoiceListItemV1(
    string Id,
    int InvoiceNumber,
    string OrganizationId,
    string? SubscriptionId,
    string? StripeInvoiceId,
    double Amount,
    double? Subtotal,
    double? TaxRate,
    string Currency,
    string Status,
    string? Description,
    DateTimeOffset InvoiceDate,
    DateTimeOffset? DueDate,
    string? PoNumber,
    string? Notes,
    string? Memo,
    string? EmailTo,
    string? EmailCc,
    DateTimeOffset? PaidAt,
    string? InvoiceUrl,
    DateTimeOffset? PeriodStart,
    DateTimeOffset? PeriodEnd,
    DateTimeOffset CreatedAt)
    : InvoiceWireV1(
        Id, InvoiceNumber, OrganizationId, SubscriptionId, StripeInvoiceId, Amount, Subtotal, TaxRate,
        Currency, Status, Description, InvoiceDate, DueDate, PoNumber, Notes, Memo, EmailTo, EmailCc,
        PaidAt, InvoiceUrl, PeriodStart, PeriodEnd, CreatedAt);

/// <summary>
/// The <c>getInvoice</c> wire shape. TS <c>getInvoice</c> uses <c>include: { subscription: true }</c>, so
/// the <c>subscription</c> key is ALWAYS present — <c>null</c> when the invoice has no subscription, the
/// nested object when it does. Reproduced by declaring <see cref="Subscription"/> WITHOUT
/// <see cref="JsonIgnoreCondition.WhenWritingNull"/> so a null value serializes as <c>"subscription":null</c>
/// (never omitted).
/// </summary>
public sealed record InvoiceDetailV1(
    string Id,
    int InvoiceNumber,
    string OrganizationId,
    string? SubscriptionId,
    string? StripeInvoiceId,
    double Amount,
    double? Subtotal,
    double? TaxRate,
    string Currency,
    string Status,
    string? Description,
    DateTimeOffset InvoiceDate,
    DateTimeOffset? DueDate,
    string? PoNumber,
    string? Notes,
    string? Memo,
    string? EmailTo,
    string? EmailCc,
    DateTimeOffset? PaidAt,
    string? InvoiceUrl,
    DateTimeOffset? PeriodStart,
    DateTimeOffset? PeriodEnd,
    DateTimeOffset CreatedAt,
    SubscriptionV1? Subscription)
    : InvoiceWireV1(
        Id, InvoiceNumber, OrganizationId, SubscriptionId, StripeInvoiceId, Amount, Subtotal, TaxRate,
        Currency, Status, Description, InvoiceDate, DueDate, PoNumber, Notes, Memo, EmailTo, EmailCc,
        PaidAt, InvoiceUrl, PeriodStart, PeriodEnd, CreatedAt);

/// <summary>
/// Pure <see cref="InvoiceRow"/> → wire mappers. <see cref="MapListItem"/> drops the subscription entirely
/// (list has no include); <see cref="MapDetail"/> maps the nested subscription (or <c>null</c>, always
/// emitted). Golden-fixtured against the raw TS billing-router shape (no schemaVersion).
/// </summary>
public static class InvoiceV1Mapper
{
    public static InvoiceListItemV1 MapListItem(InvoiceRow row) => new(
        Id: row.Id,
        InvoiceNumber: row.InvoiceNumber,
        OrganizationId: row.OrganizationId,
        SubscriptionId: row.SubscriptionId,
        StripeInvoiceId: row.StripeInvoiceId,
        Amount: row.Amount,
        Subtotal: row.Subtotal,
        TaxRate: row.TaxRate,
        Currency: row.Currency,
        Status: row.Status,
        Description: row.Description,
        InvoiceDate: row.InvoiceDate,
        DueDate: row.DueDate,
        PoNumber: row.PoNumber,
        Notes: row.Notes,
        Memo: row.Memo,
        EmailTo: row.EmailTo,
        EmailCc: row.EmailCc,
        PaidAt: row.PaidAt,
        InvoiceUrl: row.InvoiceUrl,
        PeriodStart: row.PeriodStart,
        PeriodEnd: row.PeriodEnd,
        CreatedAt: row.CreatedAt);

    public static InvoiceDetailV1 MapDetail(InvoiceRow row) => new(
        Id: row.Id,
        InvoiceNumber: row.InvoiceNumber,
        OrganizationId: row.OrganizationId,
        SubscriptionId: row.SubscriptionId,
        StripeInvoiceId: row.StripeInvoiceId,
        Amount: row.Amount,
        Subtotal: row.Subtotal,
        TaxRate: row.TaxRate,
        Currency: row.Currency,
        Status: row.Status,
        Description: row.Description,
        InvoiceDate: row.InvoiceDate,
        DueDate: row.DueDate,
        PoNumber: row.PoNumber,
        Notes: row.Notes,
        Memo: row.Memo,
        EmailTo: row.EmailTo,
        EmailCc: row.EmailCc,
        PaidAt: row.PaidAt,
        InvoiceUrl: row.InvoiceUrl,
        PeriodStart: row.PeriodStart,
        PeriodEnd: row.PeriodEnd,
        CreatedAt: row.CreatedAt,
        Subscription: row.Subscription is null ? null : SubscriptionV1Mapper.Map(row.Subscription));
}
