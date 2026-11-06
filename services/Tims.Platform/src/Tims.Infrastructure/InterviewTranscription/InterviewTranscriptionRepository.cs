using System.Text.Json;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.Audit;
using Tims.Application.InterviewTranscription;
using static Tims.Application.InterviewTranscription.InterviewTranscriptionConstants;

namespace Tims.Infrastructure.InterviewTranscription;

/// <summary>DI holder for this slice's lazily-built data source (plain text columns, no enum mapping).</summary>
public sealed class InterviewTranscriptionDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}

/// <summary>
/// Raw-Npgsql repository (the CandidateInterviewJoinRepository shape). Every statement except
/// <see cref="ResolveOrganizationAsync"/> runs as <c>app_tenant</c> with <c>app.current_org_id</c> set to the given
/// organization AND repeats <c>organization_id = @org</c> in its WHERE clause. Consent and lifecycle evidence is
/// INSERT-only into <c>audit_logs</c> (entity <c>interview</c>); the only UPDATE is <c>interviews.transcript_url</c>.
/// </summary>
public sealed class InterviewTranscriptionRepository(InterviewTranscriptionDataSourceHolder source,
    ILogger<InterviewTranscriptionRepository> logger) : IInterviewTranscriptionRepository
{
    private const int MaxRows = 500;

    public async Task<TranscriptionInterview?> FindAsync(Guid organizationId, Guid interviewId, CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await ScopeAsync(connection, transaction, organizationId, ct);
        await using var command = new NpgsqlCommand("""
            SELECT i.id,i.organization_id,i.vacancy_id,i.type,i.status,i.meeting_url,i.transcript_url,
              c.first_name,c.last_name,v.title
            FROM interviews i
            LEFT JOIN candidates c ON c.id=i.candidate_id AND c.organization_id=i.organization_id
            LEFT JOIN vacancies v ON v.id=i.vacancy_id AND v.organization_id=i.organization_id
            WHERE i.id=@id AND i.organization_id=@org
            """, connection, transaction);
        command.Parameters.AddWithValue("id", interviewId);
        command.Parameters.AddWithValue("org", organizationId);
        TranscriptionInterview? found = null;
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            if (await reader.ReadAsync(ct))
            {
                found = new(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                    reader.GetString(4), Text(reader, 5), Text(reader, 6), Text(reader, 7), Text(reader, 8),
                    Text(reader, 9));
            }
        }
        await transaction.CommitAsync(ct);
        return found;
    }

    public async Task<(Guid InterviewId, Guid OrganizationId)?> ResolveOrganizationAsync(Guid interviewId,
        CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand(
            "SELECT id,organization_id FROM interviews WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", interviewId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? (reader.GetGuid(0), reader.GetGuid(1)) : null;
    }

    public async Task<bool> RecordConsentAsync(InterviewConsentRecord record, CancellationToken ct) =>
        await InsertAsync(record.OrganizationId, record.InterviewId, ConsentAction, record.UserId,
            JsonSerializer.Serialize(new
            {
                subject = record.Subject,
                decision = record.Decision,
                textVersion = record.TextVersion,
                channel = record.Subject == SubjectCandidate ? "candidate_join_link" : "interview_room",
            }), record.IpAddress, record.UserAgent, ct);

    public async Task<IReadOnlyList<InterviewConsentRecord>> ListConsentsAsync(Guid organizationId, Guid interviewId,
        CancellationToken ct)
    {
        var rows = new List<InterviewConsentRecord>();
        foreach (var (_, actor, meta, at) in await ReadLatestConsentsAsync(organizationId, interviewId, ct))
        {
            var subject = meta.GetValueOrDefault("subject");
            var decision = meta.GetValueOrDefault("decision");
            var version = meta.GetValueOrDefault("textVersion");
            if (subject is not (SubjectCandidate or SubjectStaff) || decision is not (Accepted or Declined) ||
                version is null) continue;
            rows.Add(new InterviewConsentRecord(interviewId, organizationId, subject, actor, decision, version, at));
        }
        return rows;
    }

    public async Task<IReadOnlyList<InterviewTranscriptionEvent>> ListEventsAsync(Guid organizationId,
        Guid interviewId, CancellationToken ct)
    {
        var rows = new List<InterviewTranscriptionEvent>();
        foreach (var (id, actor, meta, at) in await ReadRecentEventsAsync(organizationId, interviewId, ct))
        {
            var state = meta.GetValueOrDefault("state");
            if (state is not (TranscriptStates.Requested or TranscriptStates.InProgress or TranscriptStates.Ready
                or TranscriptStates.Error or TranscriptStates.Rejected)) continue;
            Guid? transcriptId = Guid.TryParse(meta.GetValueOrDefault("transcriptId"), out var t) ? t : null;
            Guid? authorizedBy = Guid.TryParse(meta.GetValueOrDefault("authorizedBy"), out var a) ? a : null;
            rows.Add(new InterviewTranscriptionEvent(interviewId, organizationId, state, actor, null, transcriptId,
                meta.GetValueOrDefault("language"), at, id, authorizedBy));
        }
        return rows;
    }

    public async Task<string?> LatestTranscriptionStateAsync(Guid organizationId, Guid interviewId,
        CancellationToken ct)
    {
        var events = await ListEventsAsync(organizationId, interviewId, ct);
        return events.Count == 0 ? null : events[^1].State;
    }

    public async Task<bool> RecordEventAsync(InterviewTranscriptionEvent transcriptionEvent, CancellationToken ct) =>
        await InsertAsync(transcriptionEvent.OrganizationId, transcriptionEvent.InterviewId, EventAction,
            transcriptionEvent.UserId,
            JsonSerializer.Serialize(new
            {
                state = transcriptionEvent.State,
                provider = "daily",
                providerEventId = transcriptionEvent.ProviderEventId,
                transcriptId = transcriptionEvent.TranscriptId?.ToString("D"),
                language = transcriptionEvent.Language,
                authorizedBy = transcriptionEvent.AuthorizedBy?.ToString("D"),
            }), null, null, ct);

    public async Task<bool> HasProviderEventAsync(Guid organizationId, Guid interviewId, string providerEventId,
        CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await ScopeAsync(connection, transaction, organizationId, ct);
        await using var command = new NpgsqlCommand("""
            SELECT EXISTS(SELECT 1 FROM audit_logs WHERE organization_id=@org AND action=@action
              AND entity='interview' AND entity_id=@entity AND metadata->>'providerEventId'=@event)
            """, connection, transaction);
        command.Parameters.AddWithValue("org", organizationId);
        command.Parameters.AddWithValue("action", EventAction);
        command.Parameters.AddWithValue("entity", interviewId.ToString());
        command.Parameters.Add(new NpgsqlParameter("event", NpgsqlDbType.Text) { Value = providerEventId });
        var exists = await command.ExecuteScalarAsync(ct) is true;
        await transaction.CommitAsync(ct);
        return exists;
    }

    public async Task SetTranscriptReferenceAsync(Guid organizationId, Guid interviewId, string reference,
        CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await ScopeAsync(connection, transaction, organizationId, ct);
        await using var command = new NpgsqlCommand("""
            UPDATE interviews SET transcript_url=@ref,updated_at=now()
            WHERE id=@id AND organization_id=@org AND transcript_url IS DISTINCT FROM @ref
            """, connection, transaction);
        command.Parameters.Add(new NpgsqlParameter("ref", NpgsqlDbType.Text) { Value = reference });
        command.Parameters.AddWithValue("id", interviewId);
        command.Parameters.AddWithValue("org", organizationId);
        await command.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<TranscriptionStaffName>> ListStaffNamesAsync(Guid organizationId,
        Guid interviewId, CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await ScopeAsync(connection, transaction, organizationId, ct);
        await using var command = new NpgsqlCommand("""
            SELECT u.id,u.first_name,u.last_name FROM users u
            WHERE u.organization_id=@org AND (
              u.id IN (SELECT e.user_id FROM interview_evaluators e WHERE e.interview_id=@id)
              OR u.id IN (SELECT i.created_by_id FROM interviews i WHERE i.id=@id AND i.organization_id=@org))
            ORDER BY u.id LIMIT 50
            """, connection, transaction);
        command.Parameters.AddWithValue("org", organizationId);
        command.Parameters.AddWithValue("id", interviewId);
        var rows = new List<TranscriptionStaffName>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
                rows.Add(new(reader.GetGuid(0), Text(reader, 1) ?? "", Text(reader, 2) ?? ""));
        }
        await transaction.CommitAsync(ct);
        return rows;
    }

    public async Task<IReadOnlyList<TranscriptCompetency>> ListCompetenciesAsync(Guid organizationId, Guid vacancyId,
        CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await ScopeAsync(connection, transaction, organizationId, ct);
        await using var command = new NpgsqlCommand(
            "SELECT competencies::text FROM job_profiles WHERE vacancy_id=@v AND organization_id=@org LIMIT 1",
            connection, transaction);
        command.Parameters.AddWithValue("v", vacancyId);
        command.Parameters.AddWithValue("org", organizationId);
        var json = await command.ExecuteScalarAsync(ct) as string;
        await transaction.CommitAsync(ct);
        return ParseCompetencies(json);
    }

    /// <summary>
    /// The job profile's competencies with the SAME acceptance rule as @tims/shared resolveCompetencies (name trimmed
    /// 1..100, optional integer level 1..5, first 20 entries, duplicate names dropped). The TS side re-resolves the
    /// rating keys from this list, so the AI's competency keys are exactly the scorecard's.
    /// </summary>
    public static IReadOnlyList<TranscriptCompetency> ParseCompetencies(string? json)
    {
        var result = new List<TranscriptCompetency>();
        if (string.IsNullOrEmpty(json)) return result;
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            if (document.RootElement.ValueKind != JsonValueKind.Array) return result;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in document.RootElement.EnumerateArray().Take(20))
            {
                if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("name", out var nameElement) ||
                    nameElement.ValueKind != JsonValueKind.String) continue;
                var name = nameElement.GetString()!.Trim();
                if (name.Length is 0 or > 100) continue;
                int? level = null;
                if (item.TryGetProperty("level", out var levelElement) && levelElement.ValueKind != JsonValueKind.Null)
                {
                    if (levelElement.ValueKind != JsonValueKind.Number || !levelElement.TryGetInt32(out var parsed) ||
                        parsed is < 1 or > 5) continue;
                    level = parsed;
                }
                if (!seen.Add(name)) continue;
                result.Add(new(name, level));
            }
        }
        catch (JsonException)
        {
            return [];
        }
        return result;
    }

    /// <summary>
    /// The LATEST consent row per (subject, staff user) — DISTINCT ON, so no amount of history (repeated joins,
    /// acknowledgements) can push the newest candidate decision out of the result. Oldest first.
    /// </summary>
    private async Task<List<(Guid Id, Guid? Actor, Dictionary<string, string> Meta, DateTime At)>>
        ReadLatestConsentsAsync(Guid organizationId, Guid interviewId, CancellationToken ct) =>
        await ReadAsync(organizationId, interviewId, ConsentAction, (connection, transaction) => new NpgsqlCommand("""
            SELECT * FROM (
              SELECT DISTINCT ON (metadata->>'subject',actor_id) id,actor_id,metadata::text AS meta,created_at
              FROM audit_logs
              WHERE organization_id=@org AND action=@action AND entity='interview' AND entity_id=@entity
              ORDER BY metadata->>'subject',actor_id,created_at DESC,id DESC
            ) latest ORDER BY created_at,id
            """, connection, transaction), limit: null, ct);

    /// <summary>The NEWEST <see cref="MaxRows"/> lifecycle events (the ones every decision needs), oldest first.</summary>
    private async Task<List<(Guid Id, Guid? Actor, Dictionary<string, string> Meta, DateTime At)>>
        ReadRecentEventsAsync(Guid organizationId, Guid interviewId, CancellationToken ct) =>
        await ReadAsync(organizationId, interviewId, EventAction, (connection, transaction) => new NpgsqlCommand("""
            SELECT * FROM (
              SELECT id,actor_id,metadata::text AS meta,created_at FROM audit_logs
              WHERE organization_id=@org AND action=@action AND entity='interview' AND entity_id=@entity
              ORDER BY created_at DESC,id DESC LIMIT @limit
            ) recent ORDER BY created_at,id
            """, connection, transaction), limit: MaxRows, ct);

    /// <summary>Runs one of the two literal queries above under the tenant scope; metadata's string properties.</summary>
    private async Task<List<(Guid Id, Guid? Actor, Dictionary<string, string> Meta, DateTime At)>> ReadAsync(
        Guid organizationId, Guid interviewId, string action,
        Func<NpgsqlConnection, NpgsqlTransaction, NpgsqlCommand> query, int? limit, CancellationToken ct)
    {
        await using var connection = await source.DataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await ScopeAsync(connection, transaction, organizationId, ct);
        await using var command = query(connection, transaction);
        command.Parameters.AddWithValue("org", organizationId);
        command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("entity", interviewId.ToString());
        if (limit is { } max) command.Parameters.AddWithValue("limit", max);
        var rows = new List<(Guid, Guid?, Dictionary<string, string>, DateTime)>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
                rows.Add((reader.GetGuid(0), reader.IsDBNull(1) ? null : reader.GetGuid(1),
                    StringProperties(reader.IsDBNull(2) ? null : reader.GetString(2)), Utc(reader.GetDateTime(3))));
        }
        await transaction.CommitAsync(ct);
        return rows;
    }

    private static Dictionary<string, string> StringProperties(string? json)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrEmpty(json)) return result;
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            if (document.RootElement.ValueKind != JsonValueKind.Object) return result;
            foreach (var property in document.RootElement.EnumerateObject())
                if (property.Value.ValueKind == JsonValueKind.String) result[property.Name] = property.Value.GetString()!;
        }
        catch (JsonException)
        {
            // An unreadable row contributes nothing (fail closed: no consent is inferred from it).
        }
        return result;
    }

    private async Task<bool> InsertAsync(Guid organizationId, Guid interviewId, string action, Guid? actorId,
        string metadata, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        try
        {
            await using var connection = await source.DataSource.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            await ScopeAsync(connection, transaction, organizationId, ct);
            await using var command = new NpgsqlCommand("""
                INSERT INTO audit_logs(id,organization_id,actor_id,action,entity,entity_id,metadata,ip_address,user_agent)
                SELECT @id,@org,@actor,@action,'interview',@entity,@metadata,@ip,@ua
                WHERE EXISTS (SELECT 1 FROM interviews WHERE id=@interview AND organization_id=@org)
                """, connection, transaction);
            command.Parameters.AddWithValue("id", Guid.NewGuid());
            command.Parameters.AddWithValue("org", organizationId);
            command.Parameters.Add(new NpgsqlParameter("actor", NpgsqlDbType.Uuid) { Value = (object?)actorId ?? DBNull.Value });
            command.Parameters.AddWithValue("action", action);
            command.Parameters.AddWithValue("entity", interviewId.ToString());
            command.Parameters.AddWithValue("interview", interviewId);
            command.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb) { Value = metadata });
            command.Parameters.Add(new NpgsqlParameter("ip", NpgsqlDbType.Text)
            {
                Value = (object?)AuditAttribution.Ip(ipAddress) ?? DBNull.Value,
            });
            command.Parameters.Add(new NpgsqlParameter("ua", NpgsqlDbType.Text)
            {
                Value = (object?)AuditAttribution.UserAgent(userAgent) ?? DBNull.Value,
            });
            var inserted = await command.ExecuteNonQueryAsync(ct);
            await transaction.CommitAsync(ct);
            return inserted == 1;
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
        {
            // Interview id + action only: never metadata, attribution or provider payloads.
            logger.LogError(exception, "Interview transcription audit {Action} failed for {InterviewId}", action,
                interviewId);
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

    private static string? Text(NpgsqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
