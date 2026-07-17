using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Billing;

/// <summary>
/// The raw <c>Subscription</c> row the repository returns (the input to the v1 mapper) — a faithful
/// mirror of the Prisma <c>Subscription</c> model (billing.prisma). Enum columns (<c>plan</c> = OrgPlan,
/// <c>status</c> = SubscriptionStatus) are carried as their DB string form; every <c>DateTime?</c> is an
/// instant (<see cref="DateTimeOffset"/>). Pure data — no behavior.
/// </summary>
public sealed record SubscriptionRow(
    string Id,
    string OrganizationId,
    string? StripeCustomerId,
    string? StripeSubscriptionId,
    string Plan,
    string Status,
    DateTimeOffset? CurrentPeriodStart,
    DateTimeOffset? CurrentPeriodEnd,
    DateTimeOffset? TrialEndsAt,
    DateTimeOffset? CancelledAt,
    DateTimeOffset? LastStripeEventAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// The full-shape wire DTO of a <c>Subscription</c> — a faithful reproduction of the RAW Prisma
/// <c>Subscription</c> model as the TS billing router returns it (nested inside <c>getInvoice</c>'s
/// <c>include: { subscription: true }</c>). Every field is reproduced 1:1 (no <c>select</c>); the
/// <c>OrgPlan</c>/<c>SubscriptionStatus</c> enums cross the wire as their DB strings, and every date is
/// serialized through the shared Node-ISO converter (<c>…fffZ</c>, matching TS <c>Date.toISOString()</c>).
/// It carries no <c>schemaVersion</c> — it is only ever the nested child of <see cref="InvoiceDetailV1"/>.
/// </summary>
public sealed record SubscriptionV1(
    string Id,
    string OrganizationId,
    string? StripeCustomerId,
    string? StripeSubscriptionId,
    string Plan,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? CurrentPeriodStart,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? CurrentPeriodEnd,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? TrialEndsAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? CancelledAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? LastStripeEventAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset UpdatedAt);

/// <summary>Pure <see cref="SubscriptionRow"/> → <see cref="SubscriptionV1"/> mapper (value passthrough).</summary>
public static class SubscriptionV1Mapper
{
    public static SubscriptionV1 Map(SubscriptionRow row) => new(
        Id: row.Id,
        OrganizationId: row.OrganizationId,
        StripeCustomerId: row.StripeCustomerId,
        StripeSubscriptionId: row.StripeSubscriptionId,
        Plan: row.Plan,
        Status: row.Status,
        CurrentPeriodStart: row.CurrentPeriodStart,
        CurrentPeriodEnd: row.CurrentPeriodEnd,
        TrialEndsAt: row.TrialEndsAt,
        CancelledAt: row.CancelledAt,
        LastStripeEventAt: row.LastStripeEventAt,
        CreatedAt: row.CreatedAt,
        UpdatedAt: row.UpdatedAt);
}
