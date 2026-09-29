using System.Text.Json;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.InterviewJoin;

namespace Tims.Infrastructure.InterviewJoin;

/// <summary>DI holder for this slice's lazily-built data source (plain text columns, no enum mapping).</summary>
public sealed class CandidateInterviewJoinDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}

/// <summary>
/// Capability-scoped repository (mirrors InvitationOnboardingRepository). The hash lookup is the only
/// pre-tenant statement; every write runs as <c>app_tenant</c> with <c>app.current_org_id</c> set to the
/// organization RESOLVED from that row, and its WHERE clause repeats the organization filter.
/// </summary>
public sealed class CandidateInterviewJoinRepository(CandidateInterviewJoinDataSourceHolder source,
    ILogger<CandidateInterviewJoinRepository> logger) : ICandidateInterviewJoinRepository
{
    public const string AuditAction = "candidate_interview_join";

    public async Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT i.id,i.organization_id,i.type,i.status,i.scheduled_at,i.duration,i.cancelled_at,
              i.candidate_join_token_expires_at,i.meeting_url,c.first_name,c.last_name
            FROM interviews i
            LEFT JOIN candidates c ON c.id=i.candidate_id AND c.organization_id=i.organization_id
            WHERE i.candidate_join_token_hash=@hash
            """, connection);
        command.Parameters.Add(new NpgsqlParameter("hash", NpgsqlDbType.Varchar) { Value = tokenHash });
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
            Utc(reader.GetDateTime(4)), reader.GetInt32(5),
            reader.IsDBNull(6) ? null : Utc(reader.GetDateTime(6)),
            reader.IsDBNull(7) ? null : Utc(reader.GetDateTime(7)),
            reader.IsDBNull(8) ? null : reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetString(9),
            reader.IsDBNull(10) ? null : reader.GetString(10));
    }

    public async Task<string?> ClaimMeetingUrlAsync(Guid interviewId, Guid organizationId, string roomUrl,
        CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await ScopeAsync(connection, transaction, organizationId, ct);
        await using var command = new NpgsqlCommand("""
            UPDATE interviews SET meeting_url=@url,updated_at=now()
            WHERE id=@id AND organization_id=@org AND meeting_url IS NULL;
            SELECT meeting_url FROM interviews WHERE id=@id AND organization_id=@org;
            """, connection, transaction);
        command.Parameters.AddWithValue("url", roomUrl);
        command.Parameters.AddWithValue("id", interviewId);
        command.Parameters.AddWithValue("org", organizationId);
        var stored = await command.ExecuteScalarAsync(ct) as string;
        await transaction.CommitAsync(ct);
        return stored;
    }

    public async Task<bool> RecordAsync(CandidateJoinAudit audit, CancellationToken ct)
    {
        try
        {
            await using var connection = await source.DataSource.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            await ScopeAsync(connection, transaction, audit.OrganizationId, ct);
            await using var command = new NpgsqlCommand("""
                INSERT INTO audit_logs(id,organization_id,actor_id,action,entity,entity_id,metadata,ip_address,user_agent)
                VALUES(@id,@org,NULL,@action,'interview',@entity,@metadata,@ip,@ua)
                """, connection, transaction);
            command.Parameters.AddWithValue("id", Guid.NewGuid());
            command.Parameters.AddWithValue("org", audit.OrganizationId);
            command.Parameters.AddWithValue("action", AuditAction);
            command.Parameters.AddWithValue("entity", audit.InterviewId.ToString());
            command.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
            {
                Value = JsonSerializer.Serialize(new { outcome = audit.Outcome, actor = "candidate_join_link" }),
            });
            command.Parameters.AddWithValue("ip", (object?)audit.IpAddress ?? DBNull.Value);
            command.Parameters.AddWithValue("ua", (object?)Bounded(audit.UserAgent) ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(ct);
            await transaction.CommitAsync(ct);
            return true;
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
        {
            // Interview id + outcome only: never the token, its hash, or the caller's attribution.
            logger.LogError(exception, "Candidate interview join audit failed for {InterviewId} ({Outcome})",
                audit.InterviewId, audit.Outcome);
            return false;
        }
    }

    private static async Task ScopeAsync(NpgsqlConnection connection, NpgsqlTransaction transaction,
        Guid organizationId, CancellationToken ct)
    {
        await using var scope = new NpgsqlCommand(
            "SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id',@org,true)", connection, transaction);
        scope.Parameters.AddWithValue("org", organizationId.ToString());
        await scope.ExecuteNonQueryAsync(ct);
    }

    private static string? Bounded(string? value) => value is { Length: > 512 } ? value[..512] : value;

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
