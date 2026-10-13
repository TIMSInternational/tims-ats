using Npgsql;
using NpgsqlTypes;
using System.Text.Json;

namespace Tims.Infrastructure.CvParsing;

public sealed record CvParseLease(Guid DocumentId, Guid OrganizationId, Guid CandidateId,
    string FileKey, Guid Token, int Attempt);

/// <summary>
/// PII-free backlog snapshot. <see cref="Exhausted"/> is the all-time total (for
/// dashboards); <see cref="ExhaustedRecent"/> counts only documents that became
/// terminal inside the alert window, so an old terminal document cannot hold the
/// alarm in ALARM forever. <see cref="Deferred"/> counts budget/config deferrals.
/// </summary>
public sealed record CvRecoveryStats(long Due, long Leased, long Exhausted, long ExhaustedRecent,
    long Deferred, long OldestDueAgeSeconds);

public enum CvParseFailureCode
{
    FetchError,
    ExtractionError,
    InvalidDocument,
    BudgetDenied,
    InferenceError,
    InvalidOutput
}

/// <summary>
/// Durable claim boundary for the default-off .NET CV reconciler. The hosted
/// service is registered only when the CV recovery flag is enabled.
///
/// Cross-tenant discovery requires the internal worker's privileged connection;
/// each returned row carries its organization, and every subsequent mutation
/// matches document id, organization and lease token. No user endpoint calls this.
/// </summary>
public sealed class CvParseLeaseRepository(NpgsqlDataSource source, DateTime? createdAfterUtc = null)
{
    public const int MaxAttempts = 4;
    public const int MaxBatchSize = 10;
    public static readonly TimeSpan GracePeriod = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan ConsentGateTimeout = TimeSpan.FromSeconds(30);
    /// <summary>A document that became terminal this recently raises the recovery alert.</summary>
    public static readonly TimeSpan RecentExhaustionWindow = TimeSpan.FromMinutes(15);
    /// <summary>Longest deferral: a spent monthly budget waits for the next UTC month.</summary>
    public static readonly TimeSpan MaxDeferral = TimeSpan.FromDays(32);

    /// <summary>
    /// Activation cut-off: documents created before it are never claimed or
    /// counted, so enabling the loop cannot sweep the entire historical backlog.
    /// Null only in tests; the API host always supplies one.
    /// </summary>
    private readonly DateTime _createdAfter = createdAfterUtc is { } cutoff
        ? UtcTimestamp(cutoff)
        : DateTime.MinValue;

    /// <summary>PII-free backlog snapshot for the hosted loop's health signal.</summary>
    public async Task<CvRecoveryStats> ReadStatsAsync(DateTime nowUtc, CancellationToken ct)
    {
        var now = UtcTimestamp(nowUtc);
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var command = new NpgsqlCommand($"""
            SELECT
              count(*) FILTER (WHERE d.cv_parse_attempts < @max_attempts
                AND (d.cv_parse_next_at IS NULL OR d.cv_parse_next_at <= @now)
                AND (d.cv_parse_lease_until IS NULL OR d.cv_parse_lease_until <= @now)),
              count(*) FILTER (WHERE d.cv_parse_lease_until > @now),
              count(*) FILTER (WHERE d.cv_parse_attempts >= @max_attempts),
              count(*) FILTER (WHERE d.cv_parse_attempts >= @max_attempts
                AND d.cv_parse_failure_code IS NOT NULL AND d.updated_at >= @recent),
              count(*) FILTER (WHERE d.cv_parse_attempts < @max_attempts
                AND d.cv_parse_failure_code = 'budget_denied' AND d.cv_parse_next_at > @now),
              COALESCE(EXTRACT(EPOCH FROM @now - min(d.created_at) FILTER (
                WHERE d.cv_parse_attempts < @max_attempts
                  AND (d.cv_parse_next_at IS NULL OR d.cv_parse_next_at <= @now)
                  AND (d.cv_parse_lease_until IS NULL OR d.cv_parse_lease_until <= @now))), 0)
            FROM candidate_documents d
            JOIN candidates c ON c.id = d.candidate_id AND c.organization_id = d.organization_id
            WHERE d.type = 'cv' AND d.parsed_data IS NULL AND d.created_at <= @cutoff
              AND d.created_at >= @created_after
              AND c.deleted_at IS NULL
              AND {NotOptedOut}
              AND d.file_url ~ ('^cv-uploads/' || d.organization_id::text || @key_suffix)
              AND EXISTS (SELECT 1 FROM data_consents consent
                WHERE consent.organization_id = d.organization_id
                  AND consent.subject_user_id = d.candidate_id
                  AND consent.consent_type = 'recruitment_data_processing'
                  AND consent.withdrawn_at IS NULL)
            """, connection);
        command.Parameters.AddWithValue("max_attempts", MaxAttempts);
        AddTimestamp(command, "now", now);
        AddTimestamp(command, "cutoff", now - GracePeriod);
        AddTimestamp(command, "recent", now - RecentExhaustionWindow);
        AddEligibility(command);
        await using var reader = await command.ExecuteReaderAsync(ct).ConfigureAwait(false);
        await reader.ReadAsync(ct).ConfigureAwait(false);
        return new CvRecoveryStats(reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2),
            reader.GetInt64(3), reader.GetInt64(4), Math.Max(0, (long)reader.GetDecimal(5)));
    }

    /// <summary>
    /// Recheck consent immediately before sending extracted CV text to Bedrock.
    /// A transaction advisory lock coordinates with consent withdrawal's
    /// candidate transaction lock. The transaction stays open through the
    /// bounded inference request, so this also works through Supavisor's
    /// transaction pooler. Withdrawal waits at most for that request. A
    /// released or superseded lease never runs the callback.
    /// </summary>
    public async Task<T?> RunWithConsentGateAsync<T>(CvParseLease lease,
        Func<CancellationToken, Task<T>> work, DateTime nowUtc, CancellationToken ct) where T : class
    {
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var transaction = await connection.BeginTransactionAsync(ct).ConfigureAwait(false);
        await SetTenantScopeAsync(connection, transaction, lease.OrganizationId, ct).ConfigureAwait(false);
        await using (var acquire = new NpgsqlCommand(
            "SELECT pg_advisory_xact_lock(hashtextextended(@candidate, 0))", connection, transaction))
        {
            acquire.Parameters.AddWithValue("candidate", lease.CandidateId.ToString());
            await acquire.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        await using (var check = new NpgsqlCommand("""
            SELECT EXISTS (
              SELECT 1 FROM candidate_documents d
              JOIN candidates c ON c.id = d.candidate_id
                AND c.organization_id = d.organization_id
              WHERE d.id = @id AND d.organization_id = @org
                AND d.candidate_id = @candidate AND d.cv_parse_lease_token = @token
                AND d.cv_parse_lease_until > @now AND d.parsed_data IS NULL
                AND c.deleted_at IS NULL
                AND EXISTS (
                  SELECT 1 FROM data_consents consent
                  WHERE consent.organization_id = d.organization_id
                    AND consent.subject_user_id = d.candidate_id
                    AND consent.consent_type = 'recruitment_data_processing'
                    AND consent.withdrawn_at IS NULL)
            )
            """, connection, transaction))
        {
            check.Parameters.AddWithValue("id", lease.DocumentId);
            check.Parameters.AddWithValue("org", lease.OrganizationId);
            check.Parameters.AddWithValue("candidate", lease.CandidateId);
            check.Parameters.AddWithValue("token", lease.Token);
            AddTimestamp(check, "now", UtcTimestamp(nowUtc));
            var active = (bool)(await check.ExecuteScalarAsync(ct).ConfigureAwait(false) ?? false);
            if (!active) return null;
        }
        using var workTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        workTimeout.CancelAfter(ConsentGateTimeout);
        var result = await work(workTimeout.Token).ConfigureAwait(false);
        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return result;
    }

    public async Task<IReadOnlyList<CvParseLease>> ClaimDueAsync(int limit, DateTime nowUtc, CancellationToken ct)
    {
        if (limit is < 1 or > MaxBatchSize) throw new ArgumentOutOfRangeException(nameof(limit));
        var now = UtcTimestamp(nowUtc);
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var command = new NpgsqlCommand($"""
            WITH due AS (
              SELECT d.id
              FROM candidate_documents d
              JOIN candidates c ON c.id = d.candidate_id AND c.organization_id = d.organization_id
              WHERE d.type = 'cv' AND d.parsed_data IS NULL
                AND d.created_at <= @cutoff
                AND d.cv_parse_attempts < @max_attempts
                AND (d.cv_parse_next_at IS NULL OR d.cv_parse_next_at <= @now)
                AND (d.cv_parse_lease_until IS NULL OR d.cv_parse_lease_until <= @now)
                AND d.created_at >= @created_after
                AND c.deleted_at IS NULL
                AND {NotOptedOut}
                AND d.file_url ~ ('^cv-uploads/' || d.organization_id::text || @key_suffix)
                AND EXISTS (
                  SELECT 1 FROM data_consents consent
                  WHERE consent.organization_id = d.organization_id
                    AND consent.subject_user_id = d.candidate_id
                    AND consent.consent_type = 'recruitment_data_processing'
                    AND consent.withdrawn_at IS NULL
                )
              -- Oldest DUE first, not oldest created: a document coming back from a
              -- deferral queues behind work that became due before it.
              ORDER BY COALESCE(d.cv_parse_next_at, d.created_at), d.id
              LIMIT @limit
              FOR UPDATE OF d SKIP LOCKED
            )
            UPDATE candidate_documents d
            SET cv_parse_attempts = d.cv_parse_attempts + 1,
                cv_parse_lease_token = gen_random_uuid(),
                cv_parse_lease_until = @lease_until,
                cv_parse_next_at = NULL,
                cv_parse_failure_code = NULL,
                updated_at = @now
            FROM due WHERE d.id = due.id AND d.parsed_data IS NULL
            RETURNING d.id, d.organization_id, d.candidate_id, d.file_url,
                      d.cv_parse_lease_token, d.cv_parse_attempts
            """, connection);
        AddTimestamp(command, "cutoff", now - GracePeriod);
        AddTimestamp(command, "now", now);
        AddTimestamp(command, "lease_until", now + LeaseDuration);
        command.Parameters.AddWithValue("max_attempts", MaxAttempts);
        command.Parameters.AddWithValue("limit", limit);
        AddEligibility(command);

        var leases = new List<CvParseLease>(limit);
        await using var reader = await command.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            leases.Add(new CvParseLease(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2),
                reader.GetString(3), reader.GetGuid(4), reader.GetInt32(5)));
        }
        return leases;
    }

    /// <summary>Release a failed claim. Only its current owner can move the retry clock.</summary>
    public async Task<bool> FailAsync(CvParseLease lease, CvParseFailureCode code,
        DateTime nowUtc, CancellationToken ct)
    {
        var now = UtcTimestamp(nowUtc);
        var terminal = code == CvParseFailureCode.InvalidDocument || lease.Attempt >= MaxAttempts;
        var delay = lease.Attempt switch
        {
            1 => TimeSpan.FromMinutes(5),
            2 => TimeSpan.FromMinutes(20),
            _ => TimeSpan.FromMinutes(60)
        };
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var transaction = await connection.BeginTransactionAsync(ct).ConfigureAwait(false);
        await SetTenantScopeAsync(connection, transaction, lease.OrganizationId, ct).ConfigureAwait(false);
        await using var command = new NpgsqlCommand("""
            UPDATE candidate_documents
            SET cv_parse_attempts = CASE WHEN @terminal THEN @max_attempts ELSE cv_parse_attempts END,
                cv_parse_next_at = @next_at,
                cv_parse_lease_token = NULL,
                cv_parse_lease_until = NULL,
                cv_parse_failure_code = @reason,
                updated_at = @now
            WHERE id = @id AND organization_id = @org AND candidate_id = @candidate
              AND cv_parse_lease_token = @token AND parsed_data IS NULL
            """, connection, transaction);
        command.Parameters.AddWithValue("terminal", terminal);
        command.Parameters.AddWithValue("max_attempts", MaxAttempts);
        command.Parameters.AddWithValue("next_at", NpgsqlDbType.Timestamp,
            terminal ? DBNull.Value : now + delay);
        command.Parameters.AddWithValue("reason", FailureCode(code));
        AddTimestamp(command, "now", now);
        command.Parameters.AddWithValue("id", lease.DocumentId);
        command.Parameters.AddWithValue("org", lease.OrganizationId);
        command.Parameters.AddWithValue("candidate", lease.CandidateId);
        command.Parameters.AddWithValue("token", lease.Token);
        var changed = await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false) == 1;
        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return changed;
    }

    /// <summary>
    /// Release a claim WITHOUT consuming its attempt: the claim's increment is
    /// refunded and the document is rescheduled after <paramref name="delay"/>.
    /// Used when the failure is a tenant/platform condition (AI budget exhausted,
    /// agent disabled) rather than anything wrong with this document, so a budget
    /// denial can never exhaust a CV into a terminal state.
    /// </summary>
    public async Task<bool> DeferAsync(CvParseLease lease, CvParseFailureCode code, TimeSpan delay,
        DateTime nowUtc, CancellationToken ct)
    {
        if (delay <= TimeSpan.Zero || delay > MaxDeferral)
            throw new ArgumentOutOfRangeException(nameof(delay));
        var now = UtcTimestamp(nowUtc);
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var transaction = await connection.BeginTransactionAsync(ct).ConfigureAwait(false);
        await SetTenantScopeAsync(connection, transaction, lease.OrganizationId, ct).ConfigureAwait(false);
        await using var command = new NpgsqlCommand("""
            UPDATE candidate_documents
            SET cv_parse_attempts = GREATEST(cv_parse_attempts - 1, 0),
                cv_parse_next_at = @next_at,
                cv_parse_lease_token = NULL,
                cv_parse_lease_until = NULL,
                cv_parse_failure_code = @reason,
                updated_at = @now
            WHERE id = @id AND organization_id = @org AND candidate_id = @candidate
              AND cv_parse_lease_token = @token AND parsed_data IS NULL
            """, connection, transaction);
        AddTimestamp(command, "next_at", now + delay);
        command.Parameters.AddWithValue("reason", FailureCode(code));
        AddTimestamp(command, "now", now);
        command.Parameters.AddWithValue("id", lease.DocumentId);
        command.Parameters.AddWithValue("org", lease.OrganizationId);
        command.Parameters.AddWithValue("candidate", lease.CandidateId);
        command.Parameters.AddWithValue("token", lease.Token);
        var changed = await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false) == 1;
        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return changed;
    }

    /// <summary>
    /// Persist a validated parse and promote its two profile fields atomically.
    /// The advisory lock is the same candidate-id lock as consent withdrawal;
    /// consent and soft deletion are checked after taking it. A superseded lease
    /// or a CV already completed by the initial TS task is a no-op.
    /// </summary>
    public async Task<bool> CompleteAsync(CvParseLease lease, string parsedJson,
        string educationJson, string languagesJson, DateTime nowUtc, CancellationToken ct)
    {
        ValidateCompletionJson(parsedJson, educationJson, languagesJson);
        var now = UtcTimestamp(nowUtc);
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var transaction = await connection.BeginTransactionAsync(ct).ConfigureAwait(false);
        await SetTenantScopeAsync(connection, transaction, lease.OrganizationId, ct).ConfigureAwait(false);
        await using (var guard = new NpgsqlCommand(
            "SELECT pg_advisory_xact_lock(hashtextextended(@candidate, 0))", connection, transaction))
        {
            guard.Parameters.AddWithValue("candidate", lease.CandidateId.ToString());
            await guard.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        await using (var document = new NpgsqlCommand("""
            UPDATE candidate_documents d
            SET parsed_data = @parsed, cv_parse_lease_token = NULL,
                cv_parse_lease_until = NULL, cv_parse_next_at = NULL,
                cv_parse_failure_code = NULL, updated_at = @now
            WHERE d.id = @id AND d.organization_id = @org AND d.candidate_id = @candidate
              AND d.cv_parse_lease_token = @token AND d.parsed_data IS NULL
              AND EXISTS (
                SELECT 1 FROM candidates c
                WHERE c.id = d.candidate_id AND c.organization_id = d.organization_id
                  AND c.deleted_at IS NULL
              )
              AND EXISTS (
                SELECT 1 FROM data_consents consent
                WHERE consent.organization_id = d.organization_id
                  AND consent.subject_user_id = d.candidate_id
                  AND consent.consent_type = 'recruitment_data_processing'
                  AND consent.withdrawn_at IS NULL
              )
            """, connection, transaction))
        {
            document.Parameters.AddWithValue("parsed", NpgsqlDbType.Jsonb, parsedJson);
            AddTimestamp(document, "now", now);
            document.Parameters.AddWithValue("id", lease.DocumentId);
            document.Parameters.AddWithValue("org", lease.OrganizationId);
            document.Parameters.AddWithValue("candidate", lease.CandidateId);
            document.Parameters.AddWithValue("token", lease.Token);
            if (await document.ExecuteNonQueryAsync(ct).ConfigureAwait(false) != 1) return false;
        }

        await using (var candidate = new NpgsqlCommand("""
            UPDATE candidates SET education = @education, languages = @languages
            WHERE id = @candidate AND organization_id = @org AND deleted_at IS NULL
            """, connection, transaction))
        {
            candidate.Parameters.AddWithValue("education", NpgsqlDbType.Jsonb, educationJson);
            candidate.Parameters.AddWithValue("languages", NpgsqlDbType.Jsonb, languagesJson);
            candidate.Parameters.AddWithValue("candidate", lease.CandidateId);
            candidate.Parameters.AddWithValue("org", lease.OrganizationId);
            if (await candidate.ExecuteNonQueryAsync(ct).ConfigureAwait(false) != 1) return false;
        }

        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return true;
    }

    private static void ValidateCompletionJson(string parsed, string education, string languages)
    {
        // Storage sanity bounds, far above anything the 2048-output-token call can produce.
        if (parsed.Length > 512_000 || education.Length > 256_000 || languages.Length > 256_000)
            throw new ArgumentException("CV parser output exceeds storage limits");
        using var parsedDoc = JsonDocument.Parse(parsed);
        using var educationDoc = JsonDocument.Parse(education);
        using var languagesDoc = JsonDocument.Parse(languages);
        if (parsedDoc.RootElement.ValueKind != JsonValueKind.Object ||
            !parsedDoc.RootElement.TryGetProperty("parsed", out var marker) ||
            marker.ValueKind != JsonValueKind.True ||
            educationDoc.RootElement.ValueKind != JsonValueKind.Array ||
            languagesDoc.RootElement.ValueKind != JsonValueKind.Array)
            throw new ArgumentException("CV parser output failed validation");
    }

    private static string FailureCode(CvParseFailureCode code) => code switch
    {
        CvParseFailureCode.FetchError => "fetch_error",
        CvParseFailureCode.ExtractionError => "extraction_error",
        CvParseFailureCode.InvalidDocument => "invalid_document",
        CvParseFailureCode.BudgetDenied => "budget_denied",
        CvParseFailureCode.InferenceError => "inference_error",
        CvParseFailureCode.InvalidOutput => "invalid_output",
        _ => throw new ArgumentOutOfRangeException(nameof(code))
    };

    private static DateTime UtcTimestamp(DateTime value)
    {
        if (value.Kind != DateTimeKind.Utc) throw new ArgumentException("UTC time required", nameof(value));
        return DateTime.SpecifyKind(value, DateTimeKind.Unspecified);
    }

    /// <summary>
    /// A tenant that turned cv-parser off is never claimed or counted: its CVs are
    /// not recovery work, so they cannot re-enter the queue every hour (an S3 GET
    /// and a decode each time), starve other tenants' recovery, or hold the
    /// backlog alarm. Re-enabling the agent makes them eligible again.
    /// </summary>
    private const string NotOptedOut = """
        NOT EXISTS (
                  SELECT 1 FROM ai_agent_org_configs opt_out
                  JOIN ai_agents agent ON agent.id = opt_out.agent_id
                  WHERE agent.slug = 'cv-parser'
                    AND opt_out.organization_id = d.organization_id
                    AND opt_out.enabled = false)
        """;

    private void AddEligibility(NpgsqlCommand command)
    {
        AddTimestamp(command, "created_after", _createdAfter);
        command.Parameters.AddWithValue("key_suffix", CvObjectKey.SqlSuffixPattern);
    }

    private static void AddTimestamp(NpgsqlCommand command, string name, DateTime value) =>
        command.Parameters.AddWithValue(name, NpgsqlDbType.Timestamp, value);

    private static async Task SetTenantScopeAsync(NpgsqlConnection connection,
        NpgsqlTransaction transaction, Guid organizationId, CancellationToken ct)
    {
        await using var scope = new NpgsqlCommand("""
            SET LOCAL ROLE app_tenant;
            SELECT set_config('app.current_org_id', @org, true)
            """, connection, transaction);
        scope.Parameters.AddWithValue("org", organizationId.ToString());
        await scope.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }
}
