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

    [Fact]
    public async Task A_really_terminated_backend_is_retried_on_a_fresh_connection()
    {
        // Review HIGH-1, reproduced for real: pg_terminate_backend on the writer's own connection while its INSERT is
        // about to run. Before the fix TenantScope's rollback threw ObjectDisposedException over the transient
        // fault, the writer called it deterministic, and the row was lost.
        var entityId = Guid.NewGuid().ToString();
        var kill = new TerminateBackendOnFirstInsert(_fixture.ConnectionString);
        var logger = new ListLogger();
        await using var db = Context(_fixture.ConnectionString, kill);

        await new SecurityEventWriter(db, logger).WriteAsync(Event(entityId), CancellationToken.None);

        Assert.True(kill.Fired);
        Assert.Single(await RowsAsync(entityId));
        Assert.True(kill.InsertBackends.Count >= 2, "the retry must actually re-run the INSERT");
        Assert.NotEqual(kill.InsertBackends[0], kill.InsertBackends[^1]); // attempt 2 ran on a NEW backend
        Assert.DoesNotContain(logger.Entries, e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task TenantScope_dispose_does_not_mask_the_fault_after_the_backend_is_terminated()
    {
        // HIGH-1's other half: the rollback in TenantScope.DisposeAsync ran on a broken connection and threw over the
        // original fault. Dispose must be silent so the CALLER's exception is the one that propagates.
        await using var db = Context(_fixture.ConnectionString);
        var scope = await Tims.Infrastructure.TenantScope.BeginAsync(db, AuditWriterFixture.OrgA);
        var pid = ((NpgsqlConnection)db.Database.GetDbConnection()).ProcessID;
        await using (var admin = new NpgsqlConnection(_fixture.ConnectionString))
        {
            await admin.OpenAsync();
            await using var kill = new NpgsqlCommand("SELECT pg_terminate_backend(@pid)", admin);
            kill.Parameters.AddWithValue("pid", pid);
            await kill.ExecuteScalarAsync();
        }

        await Task.Delay(200);
        await Assert.ThrowsAnyAsync<Exception>(() => db.Database.ExecuteSqlAsync($"SELECT 1"));
        Assert.Null(await Record.ExceptionAsync(() => scope.DisposeAsync().AsTask()));
    }

    [Fact]
    public async Task A_lost_ack_dedupe_does_not_poison_the_next_write_on_the_same_context()
    {
        // Review HIGH-2: the scoped AuditLogDbContext is shared per request. After write(a)'s dedupe the stale
        // Added entity stayed tracked, so write(b)'s SaveChanges re-inserted a's row, hit the PK, and b was lost.
        var a = Guid.NewGuid().ToString();
        var b = Guid.NewGuid().ToString();
        await using var db = Context(_fixture.ConnectionString, new LostCommitAck());
        var writer = new SecurityEventWriter(db, new ListLogger());

        await writer.WriteAsync(Event(a), CancellationToken.None);
        await writer.WriteAsync(Event(b), CancellationToken.None);

        Assert.Single(await RowsAsync(a));
        Assert.Single(await RowsAsync(b));
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task A_lost_row_does_not_poison_the_next_write_on_the_same_context()
    {
        var a = Guid.NewGuid().ToString();
        var b = Guid.NewGuid().ToString();
        var fault = new InsertFault(failures: SecurityEventWriter.MaxAttempts); // every attempt of `a` fails
        await using var db = Context(_fixture.ConnectionString, fault);
        var logger = new ListLogger();
        var writer = new SecurityEventWriter(db, logger);

        await writer.WriteAsync(Event(a), CancellationToken.None);
        await writer.WriteAsync(Event(b), CancellationToken.None);

        Assert.Empty(await RowsAsync(a));
        Assert.Single(await RowsAsync(b));
        Assert.Single(logger.Entries, e => e.Level == LogLevel.Error); // only a's loss
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task A_hung_database_is_bounded_by_the_overall_deadline()
    {
        // Review MEDIUM-3: the retry budget must bound the latency added to a denied request.
        var entityId = Guid.NewGuid().ToString();
        var logger = new ListLogger();
        await using var db = Context(_fixture.ConnectionString, new HangEveryInsert());
        var clock = System.Diagnostics.Stopwatch.StartNew();

        await new SecurityEventWriter(db, logger).WriteAsync(Event(entityId), CancellationToken.None);

        clock.Stop();
        Assert.InRange(clock.Elapsed, TimeSpan.Zero, SecurityEventWriter.OverallDeadline + TimeSpan.FromSeconds(1.5));
        Assert.Empty(await RowsAsync(entityId));
        Assert.Equal(SecurityEventWriter.RowLostEventId, Assert.Single(logger.Entries, e => e.Level == LogLevel.Error).EventId);
    }

    [Theory]
    [InlineData("57P01", true)]  // admin_shutdown — a terminated backend
    [InlineData("40001", true)]  // serialization failure
    [InlineData("53300", false)] // too_many_connections — pool/server exhaustion is not retried
    [InlineData("23505", false)] // unique violation
    [InlineData("42P01", false)] // undefined table
    [InlineData("42501", false)] // insufficient privilege
    public void Server_errors_are_retried_only_when_transient(string sqlState, bool transient) =>
        Assert.Equal(transient, SecurityEventWriter.IsTransient(
            new DbUpdateException("x", new PostgresException("m", "ERROR", "ERROR", sqlState)), attemptTimedOut: false));

    [Fact]
    public void Client_pool_exhaustion_is_not_retried()
    {
        var exhausted = new NpgsqlException(
            "The connection pool has been exhausted, either raise 'Max Pool Size' (currently 100) or 'Timeout'",
            new TimeoutException());
        Assert.True(exhausted.IsTransient); // Npgsql itself calls it transient …
        Assert.False(SecurityEventWriter.IsTransient(exhausted, attemptTimedOut: false)); // … the writer does not retry it
        Assert.True(SecurityEventWriter.IsTransient(Transient(), attemptTimedOut: false));
    }

    /// <summary>Terminates the writer's own backend right before its first INSERT; records each INSERT's backend pid.</summary>
    private sealed class TerminateBackendOnFirstInsert(string connectionString) : DbCommandInterceptor
    {
        public bool Fired { get; private set; }
        public List<int> InsertBackends { get; } = [];

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("INSERT INTO audit_logs", StringComparison.OrdinalIgnoreCase))
            {
                var pid = ((NpgsqlConnection)command.Connection!).ProcessID;
                InsertBackends.Add(pid);
                if (!Fired)
                {
                    Fired = true;
                    await using var admin = new NpgsqlConnection(connectionString);
                    await admin.OpenAsync(cancellationToken);
                    await using var kill = new NpgsqlCommand("SELECT pg_terminate_backend(@pid)", admin);
                    kill.Parameters.AddWithValue("pid", pid);
                    await kill.ExecuteScalarAsync(cancellationToken);
                    await Task.Delay(200, cancellationToken);
                }
            }

            return result;
        }
    }

    /// <summary>Every INSERT hangs until its attempt is cancelled.</summary>
    private sealed class HangEveryInsert : DbCommandInterceptor
    {
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("INSERT INTO audit_logs", StringComparison.OrdinalIgnoreCase))
            {
                await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
            }

            return result;
        }
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
