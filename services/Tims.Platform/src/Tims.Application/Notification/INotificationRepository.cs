namespace Tims.Application.Notification;

/// <summary>
/// Data port for the notification READ procedures (<c>list</c>, <c>unreadCount</c>, <c>getPreferences</c>).
///
/// <para><b>Every method takes BOTH the caller's organization id and the caller's user id, and both come from
/// the JWT-resolved principal — never from request input.</b> The org id opens
/// <see cref="Tims.Infrastructure.TenantScope"/> (RLS); the user id is the hard identity filter that IS the
/// authorization boundary for this surface, exactly as <c>SelfServiceGate</c>'s contract requires. There is no
/// by-id parameter for the subject: it is always the caller.</para>
/// </summary>
public interface INotificationReadRepository
{
    /// <summary>
    /// <c>list</c> — the caller's non-archived notifications, <c>created_at DESC</c>, Prisma cursor paging.
    /// Returns up to <paramref name="limit"/> + 1 rows; the use case splits the page from the overflow row.
    /// </summary>
    Task<IReadOnlyList<NotificationRow>> ListAsync(
        Guid? organizationId,
        Guid userId,
        int limit,
        Guid? cursor,
        bool unreadOnly,
        CancellationToken cancellationToken);

    /// <summary><c>unreadCount</c> — COUNT of the caller's unread, non-archived notifications.</summary>
    Task<int> CountUnreadAsync(Guid? organizationId, Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>getPreferences</c> — the caller's preference row, or <see langword="null"/> when absent.
    /// <b>The TS procedure then CREATES the row</b>, so this read is only half of that procedure; the creation
    /// lives on <see cref="INotificationWriteRepository.CreateDefaultPreferencesAsync"/> because it is a write,
    /// even though tRPC exposes the whole thing as a <c>query</c>.
    /// </summary>
    Task<NotificationPreferencesRow?> GetPreferencesAsync(
        Guid? organizationId, Guid userId, CancellationToken cancellationToken);
}

/// <summary>
/// Data port for the notification WRITE procedures. The six self-service mutations
/// (<c>markAsRead</c>, <c>markAllAsRead</c>, <c>archive</c>, <c>archiveAllRead</c>, <c>delete</c>,
/// <c>updatePreferences</c>) hard-filter on the caller's user id exactly like the reads. The two
/// grant-gated ones (<c>create</c>, <c>bulkCreate</c>) take a TARGET user id from the request body — that is
/// the TS behaviour and it is reproduced deliberately; see the slice doc's divergence register for the
/// unvalidated-target note.
/// </summary>
public interface INotificationWriteRepository
{
    /// <summary><c>markAsRead</c> — sets read/read_at on ONE id the caller owns. Returns rows affected.</summary>
    Task<int> MarkAsReadAsync(
        Guid? organizationId, Guid userId, Guid notificationId, DateTime readAt, CancellationToken cancellationToken);

    /// <summary>
    /// <c>markAllAsRead</c> — sets read/read_at on every UNREAD notification of the caller.
    /// <b>Deliberately does NOT filter <c>archived</c></b>: the TS <c>where</c> is
    /// <c>{ userId, read: false }</c> only, so archived-and-unread rows are marked read too.
    /// </summary>
    Task<int> MarkAllAsReadAsync(
        Guid? organizationId, Guid userId, DateTime readAt, CancellationToken cancellationToken);

    /// <summary><c>archive</c> — archives ONE id the caller owns. Returns rows affected.</summary>
    Task<int> ArchiveAsync(
        Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken);

    /// <summary><c>archiveAllRead</c> — archives every read, not-yet-archived notification of the caller.</summary>
    Task<int> ArchiveAllReadAsync(Guid? organizationId, Guid userId, CancellationToken cancellationToken);

    /// <summary><c>delete</c> — hard-deletes ONE id the caller owns. Returns rows affected.</summary>
    Task<int> DeleteAsync(
        Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken);

    /// <summary>
    /// The lazy row creation inside <c>getPreferences</c> — <c>notificationPreference.create({ data: { userId } })</c>,
    /// every other column taking its database default. <c>updated_at</c> is NOT NULL with NO database default
    /// (Prisma's <c>@updatedAt</c> is client-side), so the caller MUST supply it or the INSERT fails.
    /// </summary>
    Task<NotificationPreferencesRow> CreateDefaultPreferencesAsync(
        Guid? organizationId, Guid userId, DateTime now, CancellationToken cancellationToken);

    /// <summary>
    /// <c>updatePreferences</c> — the Prisma <c>upsert</c> on the unique <c>user_id</c>. Only the keys the
    /// caller actually sent are written (the TS builds its <c>data</c> object key-by-key from
    /// <c>!== undefined</c> checks), so an absent key leaves the stored value untouched on update and takes the
    /// column default on insert.
    /// </summary>
    Task<UpdatePreferencesResult> UpsertPreferencesAsync(
        Guid? organizationId,
        Guid userId,
        NotificationPreferencesUpdate update,
        DateTime now,
        CancellationToken cancellationToken);

    /// <summary><c>create</c> — one notification for a target user; returns the <c>notificationSelect</c> row.</summary>
    Task<NotificationRow> CreateAsync(
        Guid? organizationId, NotificationCreateInput input, CancellationToken cancellationToken);

    /// <summary><c>bulkCreate</c> — one notification per target user id; returns rows inserted.</summary>
    Task<int> BulkCreateAsync(
        Guid? organizationId,
        IReadOnlyList<Guid> userIds,
        NotificationCreateContent content,
        CancellationToken cancellationToken);
}

/// <summary>
/// The partial-update payload for <c>updatePreferences</c>. Each property is a THREE-state value: absent
/// (<see langword="null"/> holder) means "the caller did not send this key — do not write the column";
/// present means write it. That distinction is load-bearing and cannot be modelled with plain nullables,
/// because <c>quietHoursStart</c>/<c>quietHoursEnd</c> are themselves <c>.nullable()</c> in Zod — sending
/// <c>null</c> explicitly WRITES NULL, while omitting the key leaves the stored value alone.
/// </summary>
public sealed record NotificationPreferencesUpdate(
    bool? EmailEnabled,
    bool? PushEnabled,
    string? CategoriesJson,
    string? ModulesJson,
    OptionalValue<string?> QuietHoursStart,
    OptionalValue<string?> QuietHoursEnd);

/// <summary>
/// A present-or-absent wrapper — the C# stand-in for the JS distinction between a key set to <c>null</c> and a
/// key that was never sent. <see cref="HasValue"/> false means "not sent".
/// </summary>
public readonly record struct OptionalValue<T>(bool HasValue, T? Value)
{
    /// <summary>The "caller did not send this key" state.</summary>
    public static OptionalValue<T> Absent => new(false, default);

    /// <summary>The "caller sent this key, with this value (possibly null)" state.</summary>
    public static OptionalValue<T> Present(T? value) => new(true, value);
}

/// <summary>The body shared by <c>create</c> and <c>bulkCreate</c>, minus the target user(s).</summary>
public sealed record NotificationCreateContent(
    string Type,
    string Title,
    string? Message,
    string? Module,
    string? EntityType,
    Guid? EntityId,
    string? ActionUrl);

/// <summary><c>create</c>'s full input — one target user plus the shared content.</summary>
public sealed record NotificationCreateInput(Guid UserId, NotificationCreateContent Content);
