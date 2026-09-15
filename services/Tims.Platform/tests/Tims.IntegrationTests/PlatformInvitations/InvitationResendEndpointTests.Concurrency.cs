using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Infrastructure.PlatformInvitations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class InvitationResendEndpointTests
{
    [Fact]
    public async Task Two_contexts_with_the_same_snapshot_and_clock_tick_cannot_both_commit()
    {
        var row = await Seed("pending");
        await using var dataSource = PlatformInvitationsDataSource.Build(fixture.ConnectionString);
        var options = new DbContextOptionsBuilder<InvitationResendDbContext>().UseNpgsql(dataSource).Options;
        await using var firstContext = new InvitationResendDbContext(options);
        await using var secondContext = new InvitationResendDbContext(options);
        var first = new InvitationResendRepository(firstContext);
        var second = new InvitationResendRepository(secondContext);
        var snapshot = (await first.FindAsync(row.Id, CancellationToken.None))!;
        var other = (await second.FindAsync(row.Id, CancellationToken.None))!;
        var results = await Task.WhenAll(
            first.MarkSentAsync(snapshot, snapshot.UpdatedAt, snapshot.UpdatedAt.AddDays(7), CancellationToken.None),
            second.MarkSentAsync(other, other.UpdatedAt, other.UpdatedAt.AddDays(7), CancellationToken.None));
        Assert.Single(results, updated => updated);
        var saved = await Read(row.Id);
        Assert.Equal(snapshot.UpdatedAt.AddMilliseconds(1), saved.UpdatedAt);
        Assert.Equal("sent", saved.Status);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Token_or_version_change_rejects_the_old_snapshot_even_while_status_is_pending(bool changeToken)
    {
        var row = await Seed("pending");
        await using var dataSource = PlatformInvitationsDataSource.Build(fixture.ConnectionString);
        await using var context = new InvitationResendDbContext(new DbContextOptionsBuilder<InvitationResendDbContext>().UseNpgsql(dataSource).Options);
        var repository = new InvitationResendRepository(context);
        var snapshot = (await repository.FindAsync(row.Id, CancellationToken.None))!;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = changeToken
            ? "UPDATE platform_invitations SET token=@token WHERE id=@id"
            : "UPDATE platform_invitations SET updated_at=updated_at + INTERVAL '1 millisecond' WHERE id=@id";
        command.Parameters.AddWithValue("id", row.Id);
        if (changeToken) command.Parameters.AddWithValue("token", Guid.NewGuid().ToString());
        await command.ExecuteNonQueryAsync();
        Assert.False(await repository.MarkSentAsync(snapshot, DateTime.UtcNow, DateTime.UtcNow.AddDays(7), CancellationToken.None));
        Assert.Equal("pending", (await Read(row.Id)).Status);
        Assert.Null((await Read(row.Id)).SentAt);
    }
}
