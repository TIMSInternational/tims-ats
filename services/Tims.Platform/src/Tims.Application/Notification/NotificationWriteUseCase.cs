namespace Tims.Application.Notification;

/// <summary>
/// The notification WRITE use case (Phase-5 Slice 25) — the C# port of the eight mutations. Deliberately thin:
/// each TS procedure is a single Prisma call whose result is returned verbatim, so the use case's whole job is
/// to wrap the affected-row count in the Prisma <c>BatchPayload</c> shape and to pass the caller identity
/// through. No business rule is invented here that the TS does not have.
/// </summary>
public sealed class NotificationWriteUseCase(INotificationWriteRepository repository)
{
    private readonly INotificationWriteRepository _repository = repository;

    /// <summary>
    /// <c>markAsRead</c> — <c>updateMany({ where: { id, userId } })</c>. An id belonging to another user
    /// matches zero rows and returns <c>{ count: 0 }</c>; it does NOT 404. That is the TS observable and it is
    /// also what keeps the endpoint from confirming whether someone else's notification id exists.
    /// </summary>
    public async Task<BatchCountResult> MarkAsReadAsync(
        Guid? organizationId, Guid userId, Guid notificationId, DateTime now, CancellationToken cancellationToken)
        => new(await _repository
            .MarkAsReadAsync(organizationId, userId, notificationId, now, cancellationToken)
            .ConfigureAwait(false));

    /// <summary><c>markAllAsRead</c> — every unread row of the caller, archived or not (TS parity).</summary>
    public async Task<BatchCountResult> MarkAllAsReadAsync(
        Guid? organizationId, Guid userId, DateTime now, CancellationToken cancellationToken)
        => new(await _repository
            .MarkAllAsReadAsync(organizationId, userId, now, cancellationToken)
            .ConfigureAwait(false));

    /// <summary><c>archive</c> — one id the caller owns.</summary>
    public async Task<BatchCountResult> ArchiveAsync(
        Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken)
        => new(await _repository
            .ArchiveAsync(organizationId, userId, notificationId, cancellationToken)
            .ConfigureAwait(false));

    /// <summary><c>archiveAllRead</c> — every read, not-yet-archived row of the caller.</summary>
    public async Task<BatchCountResult> ArchiveAllReadAsync(
        Guid? organizationId, Guid userId, CancellationToken cancellationToken)
        => new(await _repository
            .ArchiveAllReadAsync(organizationId, userId, cancellationToken)
            .ConfigureAwait(false));

    /// <summary><c>delete</c> — hard delete of one id the caller owns.</summary>
    public async Task<BatchCountResult> DeleteAsync(
        Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken)
        => new(await _repository
            .DeleteAsync(organizationId, userId, notificationId, cancellationToken)
            .ConfigureAwait(false));

    /// <summary><c>updatePreferences</c> — partial upsert; returns only <c>{ emailEnabled, pushEnabled }</c>.</summary>
    public Task<UpdatePreferencesResult> UpdatePreferencesAsync(
        Guid? organizationId,
        Guid userId,
        NotificationPreferencesUpdate update,
        DateTime now,
        CancellationToken cancellationToken)
        => _repository.UpsertPreferencesAsync(organizationId, userId, update, now, cancellationToken);

    /// <summary><c>create</c> — one notification for a target user; returns the full projection.</summary>
    public Task<NotificationRow> CreateAsync(
        Guid? organizationId, NotificationCreateInput input, CancellationToken cancellationToken)
        => _repository.CreateAsync(organizationId, input, cancellationToken);

    /// <summary><c>bulkCreate</c> — one row per target user id; returns <c>{ count }</c>.</summary>
    public async Task<BatchCountResult> BulkCreateAsync(
        Guid? organizationId,
        IReadOnlyList<Guid> userIds,
        NotificationCreateContent content,
        CancellationToken cancellationToken)
        => new(await _repository
            .BulkCreateAsync(organizationId, userIds, content, cancellationToken)
            .ConfigureAwait(false));
}
