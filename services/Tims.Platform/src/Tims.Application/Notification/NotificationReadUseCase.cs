namespace Tims.Application.Notification;

/// <summary>
/// The notification READ use case (Phase-5 Slice 25) — the C# port of <c>list</c>, <c>unreadCount</c> and
/// <c>getPreferences</c>. Thin by design: the only logic that lives here is the page/overflow split, which is
/// pure and therefore unit-testable without a database.
/// </summary>
public sealed class NotificationReadUseCase(
    INotificationReadRepository readRepository,
    INotificationWriteRepository writeRepository)
{
    private readonly INotificationReadRepository _readRepository = readRepository;
    private readonly INotificationWriteRepository _writeRepository = writeRepository;

    /// <summary>
    /// <c>list</c> — fetch <c>limit + 1</c> rows, then reproduce the TS overflow split EXACTLY:
    /// <code>
    /// if (notifications.length > limit) { const next = notifications.pop(); nextCursor = next?.id; }
    /// </code>
    ///
    /// <para>⚠️ <b>That split loses one row per page boundary, and the port reproduces the loss on purpose.</b>
    /// <c>pop()</c> returns the (limit+1)-th row — the FIRST row of the next page — and its id becomes
    /// <c>nextCursor</c>. The next call passes that id as a Prisma <c>cursor</c> with <c>skip: 1</c>, which
    /// starts the page AFTER the cursor row, so the popped row is never returned by either page. The correct
    /// cursor would be the LAST row of the page just returned. This is a pre-existing TS defect, filed
    /// separately; narrowing or fixing it here would make a step-5 parity diff uninterpretable — it could no
    /// longer separate "the port is wrong" from "the port is deliberately better".</para>
    /// </summary>
    public async Task<NotificationListResult> ListAsync(
        Guid? organizationId,
        Guid userId,
        int limit,
        Guid? cursor,
        bool unreadOnly,
        CancellationToken cancellationToken)
    {
        var rows = await _readRepository
            .ListAsync(organizationId, userId, limit, cursor, unreadOnly, cancellationToken)
            .ConfigureAwait(false);

        if (rows.Count <= limit)
        {
            // No overflow row. nextCursor stays null, which superjson's written-undefined also serialises as
            // null — see NotificationListResult.
            return new NotificationListResult(rows, null);
        }

        // rows[limit] is what TS's pop() returns: the last element of a (limit + 1)-length array.
        return new NotificationListResult([.. rows.Take(limit)], rows[limit].Id);
    }

    /// <summary><c>unreadCount</c> — <c>{ count }</c> over unread AND non-archived rows.</summary>
    public async Task<UnreadCountResult> UnreadCountAsync(
        Guid? organizationId, Guid userId, CancellationToken cancellationToken)
    {
        var count = await _readRepository
            .CountUnreadAsync(organizationId, userId, cancellationToken)
            .ConfigureAwait(false);
        return new UnreadCountResult(count);
    }

    /// <summary>
    /// <c>getPreferences</c> — read, and on a miss CREATE the row with database defaults and return it.
    ///
    /// <para>⚠️ <b>This is a tRPC <c>query</c> that WRITES</b>, and the port keeps it that way. It therefore
    /// sits behind the READ flag while needing a write-capable connection — the one place in this slice where
    /// the read/write flag split does not line up with read/write behaviour. Recorded in the slice doc so a
    /// later reader does not "fix" it by moving the endpoint under the write flag, which would change when the
    /// row gets created.</para>
    ///
    /// <para>The TS has no upsert here and no unique-violation handling, so two concurrent first-calls race:
    /// one wins, the other hits the <c>user_id</c> unique constraint. Reproduced rather than repaired.</para>
    /// </summary>
    public async Task<NotificationPreferencesRow> GetPreferencesAsync(
        Guid? organizationId, Guid userId, DateTime now, CancellationToken cancellationToken)
    {
        var existing = await _readRepository
            .GetPreferencesAsync(organizationId, userId, cancellationToken)
            .ConfigureAwait(false);
        if (existing is not null)
        {
            return existing;
        }

        return await _writeRepository
            .CreateDefaultPreferencesAsync(organizationId, userId, now, cancellationToken)
            .ConfigureAwait(false);
    }
}
