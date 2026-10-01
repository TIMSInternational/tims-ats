using System.Data.Common;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Npgsql;
using Tims.Application.Audit;
using Tims.Infrastructure.Audit;
using Xunit;

namespace Tims.IntegrationTests.Audit;

/// <summary>
/// #181 — a security-audit row is not droppable by a transient fault. Each test injects the fault with a real EF
/// interceptor over the real Postgres container, so the retry, the lost-commit-acknowledgement idempotency and the
/// ERROR-level loss signal are all observed against the actual write path rather than a fake writer.
/// </summary>
[Collection("AuditWriter")]
public sealed class SecurityEventWriterRetryTests(AuditWriterFixture fixture)
{
    private readonly AuditWriterFixture _fixture = fixture;

    private static NpgsqlException Transient() => new("simulated network fault", new TimeoutException());

    private AuditLogDbContext Context(string connectionString, params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<AuditLogDbContext>().UseNpgsql(connectionString)
            .AddInterceptors(interceptors).Options);

    private static SecurityEvent Event(string entityId, string? ip = "203.0.113.9", string? ua = "RetryTests/1.0") =>
        new(AuditWriterFixture.OrgA, AuditWriterFixture.RealOwner, "authz_denied", "platform:GET /retry-test",
            entityId, new JsonObject { ["code"] = "FORBIDDEN" }, ip, ua);

    private async Task<List<(string? Ip, string? Ua)>> RowsAsync(string entityId)
    {
        var rows = new List<(string?, string?)>();
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT ip_address, user_agent FROM audit_logs WHERE entity_id = @id", connection);
        command.Parameters.AddWithValue("id", entityId);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.IsDBNull(0) ? null : reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1)));
        }

        return rows;
    }

    [Fact]
    public async Task A_transient_fault_on_the_insert_is_retried_and_the_row_lands_once()
    {
        var entityId = Guid.NewGuid().ToString();
        var fault = new InsertFault(failures: 2);
        var logger = new ListLogger();
        await using var db = Context(_fixture.ConnectionString, fault);

        await new SecurityEventWriter(db, logger).WriteAsync(Event(entityId), CancellationToken.None);

        Assert.Equal(3, fault.Attempts);
        Assert.Single(await RowsAsync(entityId));
        Assert.DoesNotContain(logger.Entries, e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task A_commit_whose_acknowledgement_is_lost_is_not_written_twice()
    {
        // The commit SUCCEEDS server-side, then the client sees a transient fault. The retry re-inserts the SAME row
        // id, hits the primary key, and recognises the row as already written — exactly one row, no error.
        var entityId = Guid.NewGuid().ToString();
        var lostAck = new LostCommitAck();
        var logger = new ListLogger();
        await using var db = Context(_fixture.ConnectionString, lostAck);

        await new SecurityEventWriter(db, logger).WriteAsync(Event(entityId), CancellationToken.None);

        Assert.True(lostAck.Fired);
        Assert.Single(await RowsAsync(entityId));
        Assert.DoesNotContain(logger.Entries, e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task A_persistent_transient_fault_is_bounded_and_the_loss_is_logged_at_error()
    {
        var entityId = Guid.NewGuid().ToString();
        var fault = new InsertFault(failures: int.MaxValue);
        var logger = new ListLogger();
        await using var db = Context(_fixture.ConnectionString, fault);

        var thrown = await Record.ExceptionAsync(() =>
            new SecurityEventWriter(db, logger).WriteAsync(Event(entityId), CancellationToken.None));

        Assert.Null(thrown); // fail-soft contract unchanged
        Assert.Equal(SecurityEventWriter.MaxAttempts, fault.Attempts);
        Assert.Empty(await RowsAsync(entityId));
        var lost = Assert.Single(logger.Entries, e => e.Level == LogLevel.Error);
        Assert.Equal(SecurityEventWriter.RowLostEventId, lost.EventId);
    }

    [Fact]
    public async Task A_deterministic_failure_is_not_retried_but_is_still_logged_at_error()
    {
        // No audit_logs table: retrying cannot help, so exactly one attempt — and the loss is an ERROR, not the old
        // fail-soft WARNING that nothing alerts on.
        var counter = new InsertFault(failures: 0);
        var logger = new ListLogger();
        await using var db = Context(_fixture.MissingTableConnectionString, counter);

        await new SecurityEventWriter(db, logger).WriteAsync(Event(Guid.NewGuid().ToString()), CancellationToken.None);

        Assert.Equal(1, counter.Attempts);
        Assert.Equal(SecurityEventWriter.RowLostEventId, Assert.Single(logger.Entries, e => e.Level == LogLevel.Error).EventId);
    }

    [Fact]
    public async Task The_persisted_ip_and_user_agent_are_normalized()
    {
        var garbage = Guid.NewGuid().ToString();
        var v6 = Guid.NewGuid().ToString();
        await using (var db = Context(_fixture.ConnectionString))
        {
            await new SecurityEventWriter(db).WriteAsync(
                Event(garbage, ip: "10.0.0.1, x'); --", ua: "agent\r\nInjected: header"), CancellationToken.None);
        }

        await using (var db = Context(_fixture.ConnectionString))
        {
            await new SecurityEventWriter(db).WriteAsync(Event(v6, ip: "2001:DB8::1"), CancellationToken.None);
        }

        Assert.Equal((null, "agentInjected: header"), Assert.Single(await RowsAsync(garbage)));
        Assert.Equal("2001:db8::1", Assert.Single(await RowsAsync(v6)).Ip);
    }

    /// <summary>Throws a transient fault for the first <c>failures</c> INSERTs into audit_logs; counts every attempt.</summary>
    private sealed class InsertFault(int failures) : DbCommandInterceptor
    {
        public int Attempts { get; private set; }

        private void OnInsert(DbCommand command)
        {
            if (!command.CommandText.Contains("INSERT INTO audit_logs", StringComparison.OrdinalIgnoreCase)) return;
            Attempts++;
            if (Attempts <= failures) throw Transient();
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            OnInsert(command);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            OnInsert(command);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    /// <summary>Lets the first commit reach the server, then reports a transient fault to the client.</summary>
    private sealed class LostCommitAck : DbTransactionInterceptor
    {
        public bool Fired { get; private set; }

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (!Fired)
            {
                Fired = true;
                throw Transient();
            }

            return base.TransactionCommittedAsync(transaction, eventData, cancellationToken);
        }
    }

    private sealed class ListLogger : ILogger<SecurityEventWriter>
    {
        public List<(LogLevel Level, EventId EventId)> Entries { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Entries.Add((logLevel, eventId));
    }
}
