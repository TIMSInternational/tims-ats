using System.Text.Json;
using System.Text.Json.Serialization;

namespace Tims.Application.PlatformDashboard;

// Read models for getAttentionItems (Phase-5 slice 23, issue #81, PR 2 of 3) — the C# port of
// routers/platform/dashboard.ts:119 plus its pure kernel buildAttentionItems
// (routers/platform/dashboard.helpers.ts:55). TS IS THE CONTRACT: the flag is dark, so the tRPC
// procedure is the live path and these records must match it key-for-key and byte-for-byte —
// including the Spanish description strings, which are payload, not presentation.

/// <summary>
/// One attention item. The TS type (<c>dashboard.helpers.ts:3</c>) declares
/// <c>orgId?/orgName?/amount?/currency?/daysUntil?</c> as optional, and WHICH of them appear is a pure
/// function of <see cref="Type"/> — see <see cref="AttentionItemJsonConverter"/>, which is where that
/// contract is actually enforced on the wire.
/// </summary>
[JsonConverter(typeof(AttentionItemJsonConverter))]
public sealed record AttentionItem(
    string Id,
    string Type,
    string Severity,
    string Title,
    string Description,
    string? OrgId,
    string? OrgName,
    string ActionUrl,
    string ActionLabel,
    double? Amount,
    string? Currency,
    int? DaysUntil);

/// <summary>
/// Writes an <see cref="AttentionItem"/> with EXACTLY the keys the corresponding TS object literal
/// writes — no more, no fewer.
///
/// <para><b>Why a converter and not <c>[JsonIgnore(WhenWritingNull)]</c>: the two cases genuinely
/// differ, and no single attribute expresses both.</b> <c>buildAttentionItems</c> builds five different
/// object literals:
/// <list type="bullet">
/// <item><c>overdue_invoice</c> — every key, including <c>amount</c>, <c>currency</c>, <c>daysUntil</c>.</item>
/// <item><c>expiring_trial</c> — <c>daysUntil</c>, but NO <c>amount</c>/<c>currency</c> key at all.</item>
/// <item><c>failed_payment</c> — <c>amount</c>/<c>currency</c>, but NO <c>daysUntil</c> key at all.</item>
/// <item><c>pending_invitation</c> — writes <c>orgId: inv.organization?.id</c>, an explicitly-present key
/// whose value is <c>undefined</c> when the invitation carries no organization; no money, no days.</item>
/// <item><c>suspended_org</c> — org keys only.</item>
/// </list></para>
///
/// <para><b>And a written-but-undefined key is NOT the same as an absent one on this wire.</b> The
/// procedure's response goes through superjson, and superjson's <c>json</c> payload — the half
/// <c>scripts/parity/trpc.ts</c> <c>stripTrpcJson</c> hands to the differ — encodes <c>undefined</c> as
/// <c>null</c> (measured against superjson 2.2.6: <c>{a: undefined}</c> serialises to
/// <c>json: {"a": null}</c> plus a <c>meta</c> marker the harness never reads). So a
/// <c>pending_invitation</c> with no organization must emit <c>"orgId": null</c>, while an
/// <c>expiring_trial</c> must emit no <c>amount</c> key whatsoever. <c>WhenWritingNull</c> would get the
/// first case wrong; plain nullable properties would get the second wrong.</para>
///
/// <para>The alternative was a <c>dropNullish</c> normalize rule in the parity registry, which would make
/// both shapes compare equal — and would equally hide a C# side that stopped emitting <c>orgId</c> at all.
/// Reproducing the key set is the port; the registry entry deliberately carries no normalize rule.</para>
/// </summary>
public sealed class AttentionItemJsonConverter : JsonConverter<AttentionItem>
{
    /// <summary>Item types that carry <c>amount</c> + <c>currency</c> keys.</summary>
    private static readonly string[] WithMoney = ["overdue_invoice", "failed_payment"];

    /// <summary>Item types that carry a <c>daysUntil</c> key.</summary>
    private static readonly string[] WithDaysUntil = ["overdue_invoice", "expiring_trial"];

    public override AttentionItem Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException("AttentionItem is response-only; nothing deserialises it.");

    public override void Write(Utf8JsonWriter writer, AttentionItem value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();

        // The five keys every literal writes, in the TS literal's own order. Key ORDER is not itself
        // load-bearing (scripts/parity/normalize.ts `diff` walks a key-set union), but matching it keeps
        // a hand-comparison of the two payloads readable.
        writer.WriteString("id", value.Id);
        writer.WriteString("type", value.Type);
        writer.WriteString("severity", value.Severity);
        writer.WriteString("title", value.Title);
        writer.WriteString("description", value.Description);

        // Always written by all five literals — as `null` when the source relation was absent, which
        // only `pending_invitation` can produce.
        WriteNullableString(writer, "orgId", value.OrgId);
        WriteNullableString(writer, "orgName", value.OrgName);

        writer.WriteString("actionUrl", value.ActionUrl);
        writer.WriteString("actionLabel", value.ActionLabel);

        if (Array.IndexOf(WithMoney, value.Type) >= 0)
        {
            // Non-null for both money-bearing types: an invoice amount is NOT NULL, and a failed payment
            // uses the plan price. Written through the nullable helper anyway so a future type that
            // carries money without an amount degrades to `null` rather than throwing.
            if (value.Amount is { } amount)
            {
                writer.WriteNumber("amount", amount);
            }
            else
            {
                writer.WriteNull("amount");
            }

            WriteNullableString(writer, "currency", value.Currency);
        }

        if (Array.IndexOf(WithDaysUntil, value.Type) >= 0)
        {
            if (value.DaysUntil is { } daysUntil)
            {
                writer.WriteNumber("daysUntil", daysUntil);
            }
            else
            {
                writer.WriteNull("daysUntil");
            }
        }

        writer.WriteEndObject();
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null)
        {
            writer.WriteNull(name);
        }
        else
        {
            writer.WriteString(name, value);
        }
    }
}

/// <summary>An overdue invoice row — <c>{ id, amount, currency, dueDate, organization: { id, name } }</c>.
/// <c>organization</c> is a REQUIRED Prisma relation (<c>invoices.organization_id</c> is NOT NULL), so the
/// org fields are non-nullable here; <c>dueDate</c> is nullable in the schema even though the query filters
/// on it, and the kernel's <c>inv.dueDate ? … : 0</c> guard is reproduced rather than removed.</summary>
public sealed record OverdueInvoiceRow(string Id, double Amount, string Currency, DateTime? DueDate, string OrgId, string OrgName);

/// <summary>A trial expiring inside seven days — <c>{ id, trialEndsAt, organization: { id, name } }</c>.
/// </summary>
public sealed record ExpiringTrialRow(string Id, DateTime? TrialEndsAt, string OrgId, string OrgName);

/// <summary>A past-due subscription — <c>{ id, plan, organization: { id, name } }</c>.</summary>
public sealed record PastDueSubscriptionRow(string Id, string Plan, string OrgId, string OrgName);

/// <summary>An invitation still pending/sent more than five days after it was created —
/// <c>{ id, email, createdAt, organization: { id, name } | null }</c>. This is the ONLY row type whose
/// organization is genuinely optional (<c>platform_invitations.organization_id</c> is nullable).</summary>
public sealed record StaleInvitationRow(string Id, string Email, DateTime CreatedAt, string? OrgId, string? OrgName);

/// <summary>A suspended organization — <c>{ id, name }</c>.</summary>
public sealed record SuspendedOrgRow(string Id, string Name);
