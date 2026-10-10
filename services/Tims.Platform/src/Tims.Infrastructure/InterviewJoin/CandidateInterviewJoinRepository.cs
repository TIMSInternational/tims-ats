using System.Text.Json;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.Audit;
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

    /// <remarks>
    /// INNER join on a LIVE candidate of the same organization: a link whose candidate was soft-deleted (or is
    /// missing / in another org) resolves to nothing, i.e. <c>invalid</c> — a removed candidate's emailed link
    /// never mints a room token.
    /// <para>#329 item 5 — the same statement also reports the two states that must revoke the link early: the
    /// organization's suspension (<c>is_active</c>/<c>deleted_at</c>, the same predicate the API-key lockout uses)
    /// and the application's closure. An interview whose <c>application_id</c> no longer resolves inside its own
    /// organization is treated as CLOSED, never as "no application" — fail closed.</para>
    /// </remarks>
    public async Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT i.id,i.organization_id,i.type,i.status,i.scheduled_at,i.duration,i.cancelled_at,
              i.candidate_join_token_expires_at,i.meeting_url,c.first_name,c.last_name,
              (i.application_id IS NOT NULL AND (a.id IS NULL OR a.status IN ('rejected','withdrawn')
                OR a.rejected_at IS NOT NULL)) AS application_closed,
              (o.id IS NULL OR NOT o.is_active OR o.deleted_at IS NOT NULL) AS organization_inactive
            FROM interviews i
            JOIN candidates c ON c.id=i.candidate_id AND c.organization_id=i.organization_id
              AND c.deleted_at IS NULL
            LEFT JOIN applications a ON a.id=i.application_id AND a.organization_id=i.organization_id
            LEFT JOIN organizations o ON o.id=i.organization_id
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
            reader.IsDBNull(10) ? null : reader.GetString(10),
            ApplicationClosed: reader.GetBoolean(11),
            OrganizationInactive: reader.GetBoolean(12));
    }

    /// <remarks>
    /// Pre-tenant and cross-organization by design (the collision is cross-tenant), on the same privileged base
    /// connection as the hash lookup. The room name is compared after stripping scheme/host, query and fragment so
    /// a differently-spelled URL for the same room still counts. The interview's OWN row must be visible too: if
    /// it is not, this connection cannot see interviews at all (e.g. a non-BYPASSRLS login under forced RLS) and
    /// "no other row" would be a blind answer — that is reported as shared, i.e. fail closed.
    /// </remarks>
    public async Task<bool> IsRoomSharedAsync(Guid interviewId, string roomName, CancellationToken ct)
    {
        try
        {
            await using var connection = await source.DataSource.OpenConnectionAsync(ct);
            await using var command = new NpgsqlCommand("""
                SELECT count(*) FILTER (WHERE id=@id), count(*) FILTER (WHERE id<>@id)
                FROM interviews
                WHERE lower(split_part(split_part(split_part(meeting_url,'#',1),'?',1),'/',4))=lower(@room)
                """, connection);
            command.Parameters.AddWithValue("id", interviewId);
            command.Parameters.Add(new NpgsqlParameter("room", NpgsqlDbType.Text) { Value = roomName });
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return true;
            return reader.GetInt64(0) == 0 || reader.GetInt64(1) > 0;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Any failure (not just NpgsqlException — e.g. InvalidOperationException from the pool) fails CLOSED.
            logger.LogError(exception, "Candidate interview join room-collision check failed for {InterviewId}",
                interviewId);
            return true;
        }
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
            // Same normalization as every security-audit row (#181): an IP literal or NULL; UA bounded and stripped.
            command.Parameters.AddWithValue("ip", (object?)AuditAttribution.Ip(audit.IpAddress) ?? DBNull.Value);
            command.Parameters.AddWithValue("ua", (object?)AuditAttribution.UserAgent(audit.UserAgent) ?? DBNull.Value);
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

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
