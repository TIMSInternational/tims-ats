using Npgsql;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class InvitationResendEndpointTests
{
    private async Task<(Guid Id, string Token)> Seed(string status)
    {
        var id = Guid.NewGuid();
        var token = Guid.NewGuid().ToString();
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO platform_invitations
              (id,email,type,organization_id,organization_name,token,status,invited_by_id,expires_at,updated_at)
            VALUES (@id,'recipient@example.test','user',@org,'<script>hostile</script>',@token,
              @status::"InvitationStatus",@actor,'2026-01-01','2026-01-01')
            """;
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("org", PlatformInvitationsReadFixture.OrgB);
        command.Parameters.AddWithValue("actor", PlatformInvitationsReadFixture.PlatformOwnerId);
        command.Parameters.AddWithValue("token", token);
        command.Parameters.AddWithValue("status", status);
        await command.ExecuteNonQueryAsync();
        return (id, token);
    }

    private sealed record Row(string Status, DateTime? SentAt, DateTime ExpiresAt, DateTime UpdatedAt, string Token);

    private async Task<Row> Read(Guid id)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT status::text,sent_at,expires_at,updated_at,token FROM platform_invitations WHERE id=@id";
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return new(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetDateTime(1), reader.GetDateTime(2), reader.GetDateTime(3), reader.GetString(4));
    }

    private async Task ChangeStatus(Guid id, string status)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE platform_invitations SET status=@status::\"InvitationStatus\",updated_at=CURRENT_TIMESTAMP WHERE id=@id";
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("status", status);
        await command.ExecuteNonQueryAsync();
    }

    private async Task AssertAudit(Guid id, string outcome, string token)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT organization_id,actor_id,metadata::text FROM audit_logs WHERE entity_id=@id AND action='invitation_resend'";
        command.Parameters.AddWithValue("id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(PlatformInvitationsReadFixture.OrgB, reader.GetGuid(0));
        Assert.Equal(PlatformInvitationsReadFixture.PlatformOwnerId, reader.GetGuid(1));
        Assert.Contains(outcome, reader.GetString(2));
        Assert.DoesNotContain(token, reader.GetString(2));
        Assert.DoesNotContain("recipient", reader.GetString(2));
    }
}
