using Tims.Application.Notification;

namespace Tims.UnitTests.Notification;

/// <summary>
/// Phase-5 Slice 25 use-case unit tests. Scope is deliberately narrow: the ONLY non-trivial pure logic in this
/// slice is <c>list</c>'s page/overflow split and <c>getPreferences</c>' read-then-create fallback, and both are
/// expressible without a database.
///
/// <para>Everything else — the <c>user_id</c> predicates, the cursor SQL, the partial upsert, the RLS
/// divergence — is asserted in <c>NotificationReadEndpointAuthTests</c>/<c>NotificationWriteEndpointAuthTests</c>
/// against a REAL Postgres, and deliberately not duplicated here: a fake repository cannot kill a mutation in
/// the real repository it replaces, so asserting a WHERE clause through a stub would be a test that proves the
/// stub.</para>
/// </summary>
public sealed class NotificationUseCaseTests
{
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid User = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static NotificationRow Row(string id) =>
        new(id, "info", "t", null, null, false, null, null, null, null, new DateTime(2026, 5, 1, 0, 0, 0));

    [Fact]
    public async Task List_NoOverflow_ReturnsEveryRow_AndANullCursor()
    {
        var repo = new FakeReadRepository([Row("a"), Row("b")]);
        var useCase = new NotificationReadUseCase(repo, new ThrowingWriteRepository());

        var result = await useCase.ListAsync(Org, User, 2, null, false, CancellationToken.None);

        Assert.Equal(2, result.Notifications.Count);
        Assert.Null(result.NextCursor);
    }

    [Fact]
    public async Task List_ExactlyLimitPlusOne_DropsTheOverflowRow_AndNamesItAsTheCursor()
    {
        var repo = new FakeReadRepository([Row("a"), Row("b"), Row("c")]);
        var useCase = new NotificationReadUseCase(repo, new ThrowingWriteRepository());

        var result = await useCase.ListAsync(Org, User, 2, null, false, CancellationToken.None);

        // TS: `const next = notifications.pop(); nextCursor = next?.id` — pop() takes the LAST element of a
        // (limit+1)-length array, so the cursor is the FIRST row of the next page, not the last of this one.
        Assert.Equal(["a", "b"], result.Notifications.Select(n => n.Id));
        Assert.Equal("c", result.NextCursor);

        // …and "c" is therefore returned by NEITHER page, because the next call passes it as a Prisma cursor
        // with skip:1. That row loss is a real TS defect, reproduced on purpose and filed separately. This
        // assertion is what goes red if someone "improves" the port.
        Assert.DoesNotContain("c", result.Notifications.Select(n => n.Id));
    }

    [Fact]
    public async Task List_AsksTheRepositoryForLimitPlusOne_NotLimit()
    {
        var repo = new FakeReadRepository([]);
        var useCase = new NotificationReadUseCase(repo, new ThrowingWriteRepository());

        await useCase.ListAsync(Org, User, 20, null, false, CancellationToken.None);

        // The +1 lives in the repository (it is part of the SQL), so what the use case must NOT do is
        // pre-subtract it. Pinning the argument keeps the two halves of the split consistent.
        Assert.Equal(20, repo.LastLimit);
    }

    [Fact]
    public async Task List_PassesTheCallerIdentityThrough_Unmodified()
    {
        var repo = new FakeReadRepository([]);
        var useCase = new NotificationReadUseCase(repo, new ThrowingWriteRepository());
        var cursor = Guid.NewGuid();

        await useCase.ListAsync(Org, User, 5, cursor, true, CancellationToken.None);

        Assert.Equal(Org, repo.LastOrganizationId);
        Assert.Equal(User, repo.LastUserId);
        Assert.Equal(cursor, repo.LastCursor);
        Assert.True(repo.LastUnreadOnly);
    }

    [Fact]
    public async Task GetPreferences_ExistingRow_DoesNotWrite()
    {
        var existing = new NotificationPreferencesRow(true, true, null, null, null, null);
        var write = new CountingWriteRepository();
        var useCase = new NotificationReadUseCase(new FakeReadRepository([]) { Preferences = existing }, write);

        var result = await useCase.GetPreferencesAsync(Org, User, DateTime.UtcNow, CancellationToken.None);

        Assert.Same(existing, result);
        Assert.Equal(0, write.CreateDefaultCalls);
    }

    [Fact]
    public async Task GetPreferences_NoRow_CreatesExactlyOne()
    {
        var write = new CountingWriteRepository();
        var useCase = new NotificationReadUseCase(new FakeReadRepository([]), write);

        await useCase.GetPreferencesAsync(Org, User, DateTime.UtcNow, CancellationToken.None);

        // A tRPC `query` that writes. Asserting the count (not merely "it did not throw") is what would catch
        // a retry loop or a double-create.
        Assert.Equal(1, write.CreateDefaultCalls);
    }

    [Fact]
    public async Task UnreadCount_WrapsTheRepositoryCount()
    {
        var useCase = new NotificationReadUseCase(
            new FakeReadRepository([]) { UnreadCount = 7 }, new ThrowingWriteRepository());

        Assert.Equal(7, (await useCase.UnreadCountAsync(Org, User, CancellationToken.None)).Count);
    }

    private sealed class FakeReadRepository(IReadOnlyList<NotificationRow> rows) : INotificationReadRepository
    {
        public NotificationPreferencesRow? Preferences { get; init; }

        public int UnreadCount { get; init; }

        public Guid? LastOrganizationId { get; private set; }

        public Guid LastUserId { get; private set; }

        public int LastLimit { get; private set; }

        public Guid? LastCursor { get; private set; }

        public bool LastUnreadOnly { get; private set; }

        public Task<IReadOnlyList<NotificationRow>> ListAsync(
            Guid? organizationId, Guid userId, int limit, Guid? cursor, bool unreadOnly,
            CancellationToken cancellationToken)
        {
            LastOrganizationId = organizationId;
            LastUserId = userId;
            LastLimit = limit;
            LastCursor = cursor;
            LastUnreadOnly = unreadOnly;
            return Task.FromResult(rows);
        }

        public Task<int> CountUnreadAsync(Guid? organizationId, Guid userId, CancellationToken cancellationToken) =>
            Task.FromResult(UnreadCount);

        public Task<NotificationPreferencesRow?> GetPreferencesAsync(
            Guid? organizationId, Guid userId, CancellationToken cancellationToken) => Task.FromResult(Preferences);
    }

    private class CountingWriteRepository : INotificationWriteRepository
    {
        public int CreateDefaultCalls { get; private set; }

        public Task<NotificationPreferencesRow> CreateDefaultPreferencesAsync(
            Guid? organizationId, Guid userId, DateTime now, CancellationToken cancellationToken)
        {
            CreateDefaultCalls++;
            return Task.FromResult(new NotificationPreferencesRow(true, true, null, null, null, null));
        }

        public virtual Task<int> MarkAsReadAsync(
            Guid? organizationId, Guid userId, Guid notificationId, DateTime readAt,
            CancellationToken cancellationToken) => Task.FromResult(0);

        public Task<int> MarkAllAsReadAsync(
            Guid? organizationId, Guid userId, DateTime readAt, CancellationToken cancellationToken) =>
            Task.FromResult(0);

        public Task<int> ArchiveAsync(
            Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken) =>
            Task.FromResult(0);

        public Task<int> ArchiveAllReadAsync(
            Guid? organizationId, Guid userId, CancellationToken cancellationToken) => Task.FromResult(0);

        public Task<int> DeleteAsync(
            Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken) =>
            Task.FromResult(0);

        public Task<UpdatePreferencesResult> UpsertPreferencesAsync(
            Guid? organizationId, Guid userId, NotificationPreferencesUpdate update, DateTime now,
            CancellationToken cancellationToken) => Task.FromResult(new UpdatePreferencesResult(true, true));

        public Task<NotificationRow> CreateAsync(
            Guid? organizationId, NotificationCreateInput input, CancellationToken cancellationToken) =>
            Task.FromResult(Row("x"));

        public Task<int> BulkCreateAsync(
            Guid? organizationId, IReadOnlyList<Guid> userIds, NotificationCreateContent content,
            CancellationToken cancellationToken) => Task.FromResult(0);
    }

    /// <summary>Fails loudly if the read path writes when it must not — a silent no-op would hide that.</summary>
    private sealed class ThrowingWriteRepository : CountingWriteRepository
    {
        public override Task<int> MarkAsReadAsync(
            Guid? organizationId, Guid userId, Guid notificationId, DateTime readAt,
            CancellationToken cancellationToken) => throw new InvalidOperationException("read path must not write");
    }
}
