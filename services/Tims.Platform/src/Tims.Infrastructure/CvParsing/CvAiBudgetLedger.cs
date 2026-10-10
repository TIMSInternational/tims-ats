using Npgsql;
using NpgsqlTypes;

namespace Tims.Infrastructure.CvParsing;

public sealed class CvAiBudgetDeniedException : Exception
{
    public CvAiBudgetDeniedException() : base("CV AI budget or configuration denied") { }
}

/// <summary>
/// Checks the existing per-organization cv-parser budget and records every
/// Bedrock response, including invalid JSON. No CV text or model output enters
/// the ledger. The API loop admits at most two calls at once; the existing TS
/// caller can also spend, so this is a conservative gate rather than an exact
/// cross-runtime reservation system.
/// </summary>
public interface ICvAiBudgetLedger
{
    Task<Guid> AuthorizeAsync(Guid organizationId, DateTime nowUtc, CancellationToken ct);
    Task RecordAsync(Guid agentId, Guid organizationId, int inputTokens, int outputTokens,
        int latencyMs, DateTime nowUtc, CancellationToken ct);
}

public sealed class CvAiBudgetLedger(NpgsqlDataSource source, double defaultMonthlyBudgetUsd = 25)
    : ICvAiBudgetLedger
{
    public async Task<Guid> AuthorizeAsync(Guid organizationId, DateTime nowUtc, CancellationToken ct)
    {
        if (defaultMonthlyBudgetUsd is <= 0 or > 10_000 || double.IsNaN(defaultMonthlyBudgetUsd))
            throw new InvalidOperationException("Invalid CV AI default budget");
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var transaction = await connection.BeginTransactionAsync(ct).ConfigureAwait(false);
        await SetScopeAsync(connection, transaction, organizationId, ct).ConfigureAwait(false);
        await using var command = new NpgsqlCommand("""
            SELECT agent.id, COALESCE(config.enabled, true),
                   COALESCE(config.monthly_budget, @default_budget),
                   COALESCE((SELECT SUM(log.cost_usd) FROM ai_agent_usage_logs log
                     WHERE log.agent_id = agent.id AND log.organization_id = @org
                       AND log.created_at >= date_trunc('month', @now::timestamp)), 0)
            FROM ai_agents agent
            LEFT JOIN ai_agent_org_configs config
              ON config.agent_id = agent.id AND config.organization_id = @org
            WHERE agent.slug = 'cv-parser' AND agent.status = 'active'
            """, connection, transaction);
        command.Parameters.AddWithValue("org", organizationId);
        command.Parameters.AddWithValue("default_budget", defaultMonthlyBudgetUsd);
        command.Parameters.AddWithValue("now", NpgsqlDbType.Timestamp,
            DateTime.SpecifyKind(nowUtc, DateTimeKind.Unspecified));
        await using var reader = await command.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) throw new CvAiBudgetDeniedException();
        var budget = reader.GetDouble(2);
        var spent = reader.GetDouble(3);
        if (!reader.GetBoolean(1) || !double.IsFinite(budget) || budget <= 0 ||
            !double.IsFinite(spent) || spent < 0 || spent >= budget)
            throw new CvAiBudgetDeniedException();
        var agentId = reader.GetGuid(0);
        await reader.DisposeAsync().ConfigureAwait(false);
        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return agentId;
    }

    public async Task RecordAsync(Guid agentId, Guid organizationId, int inputTokens,
        int outputTokens, int latencyMs, DateTime nowUtc, CancellationToken ct)
    {
        if (inputTokens < 0 || outputTokens < 0 || latencyMs < 0)
            throw new ArgumentOutOfRangeException(nameof(inputTokens));
        // Mirror the current TS Haiku rate until pricing is moved to a versioned
        // provider-price registry. This is metering, not customer billing.
        var costUsd = inputTokens / 1000.0 * 0.001 + outputTokens / 1000.0 * 0.005;
        await using var connection = await source.OpenConnectionAsync(ct).ConfigureAwait(false);
        await using var transaction = await connection.BeginTransactionAsync(ct).ConfigureAwait(false);
        await SetScopeAsync(connection, transaction, organizationId, ct).ConfigureAwait(false);
        await using var command = new NpgsqlCommand("""
            INSERT INTO ai_agent_usage_logs
              (id, agent_id, organization_id, input_tokens, output_tokens,
               cost_usd, latency_ms, cached, created_at)
            VALUES (gen_random_uuid(), @agent, @org, @input, @output,
                    @cost, @latency, false, @now)
            """, connection, transaction);
        command.Parameters.AddWithValue("agent", agentId);
        command.Parameters.AddWithValue("org", organizationId);
        command.Parameters.AddWithValue("input", inputTokens);
        command.Parameters.AddWithValue("output", outputTokens);
        command.Parameters.AddWithValue("cost", costUsd);
        command.Parameters.AddWithValue("latency", latencyMs);
        command.Parameters.AddWithValue("now", NpgsqlDbType.Timestamp,
            DateTime.SpecifyKind(nowUtc, DateTimeKind.Unspecified));
        await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        await transaction.CommitAsync(ct).ConfigureAwait(false);
    }

    private static async Task SetScopeAsync(NpgsqlConnection connection,
        NpgsqlTransaction transaction, Guid organizationId, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            SET LOCAL ROLE app_tenant;
            SELECT set_config('app.current_org_id', @org, true)
            """, connection, transaction);
        command.Parameters.AddWithValue("org", organizationId.ToString());
        await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }
}
