using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Application.Notification;

/// <summary>
/// Response models for the notification slice (Phase-5 Slice 25) — the C# port of the TS <c>notification</c>
/// router's payloads.
///
/// <para><b>Every date carries <see cref="NodeIsoDateTimeConverter"/>, and that is not optional</b> (TRAP 6):
/// <c>notifications.created_at</c> / <c>read_at</c> are <c>timestamp without time zone</c>, so Npgsql
/// materialises <see cref="DateTimeKind.Unspecified"/> and default STJ emits <c>2026-08-19T12:00:00.123</c> —
/// no <c>Z</c>, and <c>.000</c> dropped entirely when milliseconds are zero. The TS side goes through superjson
/// and <c>Date.prototype.toISOString()</c>: always 3-digit ms, always <c>Z</c>. <c>created_at</c> is NOT NULL,
/// so a bare <see cref="DateTime"/> here is a GUARANTEED parity failure on every row, not a latent one.</para>
///
/// <para>Ids are emitted as <see cref="string"/> (<c>Guid.ToString()</c>), matching the TS uuid strings and the
/// <c>WeightProfileRow</c> precedent. jsonb columns are carried as <see cref="JsonNode"/> so STJ emits real JSON
/// rather than a JSON-escaped string.</para>
/// </summary>
/// <remarks>
/// The projection is the TS <c>notificationSelect</c> EXACTLY — 11 keys, in TS order. Note what is deliberately
/// ABSENT and must stay absent: <c>archived</c>, <c>organizationId</c> and <c>userId</c> are columns the TS
/// select does not return, so adding them here would be a data-exposure divergence, not a convenience.
/// </remarks>
public sealed record NotificationRow(
    string Id,
    string Type,
    string Title,
    string? Message,
    string? Module,
    bool Read,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? ReadAt,
    string? EntityType,
    string? EntityId,
    string? ActionUrl,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt);

/// <summary>
/// <c>list</c> → <c>{ notifications, nextCursor }</c>.
///
/// <para><b><see cref="NextCursor"/> is always WRITTEN, never omitted.</b> The TS builds the literal
/// <c>{ notifications, nextCursor }</c> with <c>let nextCursor: string | undefined</c>, so on the last page the
/// key is present-and-undefined — and superjson serialises a written-<c>undefined</c> property as
/// <c>null</c> (measured, superjson 2.2.6), while a never-written key is ABSENT. A plain nullable property is
/// therefore correct here; <c>[JsonIgnore(WhenWritingNull)]</c> would emit the never-written shape and diff.</para>
/// </summary>
public sealed record NotificationListResult(IReadOnlyList<NotificationRow> Notifications, string? NextCursor);

/// <summary><c>unreadCount</c> → <c>{ count }</c>.</summary>
public sealed record UnreadCountResult(int Count);

/// <summary>
/// The Prisma <c>BatchPayload</c> shape — <c>{ count }</c> — returned verbatim by <c>markAsRead</c>,
/// <c>markAllAsRead</c>, <c>archive</c>, <c>archiveAllRead</c>, <c>delete</c> and <c>bulkCreate</c>. The TS
/// procedures <c>return</c> the <c>updateMany</c>/<c>deleteMany</c>/<c>createMany</c> result directly, so the
/// count of AFFECTED ROWS is the observable contract — including <c>0</c> for an id the caller does not own,
/// which is how those mutations avoid confirming another user's notification id.
/// </summary>
public sealed record BatchCountResult(int Count);

/// <summary>
/// <c>getPreferences</c> → the six selected preference columns. <c>categories</c>/<c>modules</c> are jsonb
/// (NOT NULL, with row defaults), carried as <see cref="JsonNode"/>. Note the TS select deliberately omits
/// <c>id</c>, <c>userId</c>, <c>createdAt</c> and <c>updatedAt</c>.
/// </summary>
public sealed record NotificationPreferencesRow(
    bool EmailEnabled,
    bool PushEnabled,
    JsonNode? Categories,
    JsonNode? Modules,
    string? QuietHoursStart,
    string? QuietHoursEnd);

/// <summary>
/// <c>updatePreferences</c> → <c>{ emailEnabled, pushEnabled }</c> ONLY. The TS upsert's
/// <c>select</c> is narrower than <c>getPreferences</c>', and reproducing that narrowness is the point:
/// widening it would be a divergence the parity harness could not distinguish from a port bug.
/// </summary>
public sealed record UpdatePreferencesResult(bool EmailEnabled, bool PushEnabled);
