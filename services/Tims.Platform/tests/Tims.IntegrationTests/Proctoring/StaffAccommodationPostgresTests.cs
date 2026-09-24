using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>Real PostgreSQL/RLS proof for the one-assignment accommodation write.</summary>
public sealed class StaffAccommodationPostgresTests : IAsyncLifetime
{
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Staff = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid Eligible = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc01");
    private static readonly Guid Hidden = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc02");
    private static readonly Guid Started = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc03");
    private static readonly Guid NoLongerRequired = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc04");
    private static readonly Guid HasSession = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc05");
    private static readonly Guid OtherTenant = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc06");
    private static readonly Guid AuditFailure = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc07");
    private static readonly Guid Race = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc08");

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres").WithPassword("postgres")
        .WithDatabase("tims_proctoring_accommodation").Build();
    private string _connectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
        await ExecuteAsync("CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;");
        await ExecuteAsync(SchemaSql);
        await ExecuteAsync(SeedSql);
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    [Fact]
    public async Task Accommodation_IsScopedAtomicAndOnlyAvailableBeforeStart()
    {
        await using var db = NewContext();
        var store = NewStore(db);
        var ownScope = Scope(AccessScope.Own);

        var response = await store.AccommodateAsync(ownScope, Eligible, Staff,
            "technical_unavailable", null, null, default);
        Assert.Equal(Eligible, response.AssignmentId);
        Assert.False(response.ProctoringRequired);
        Assert.Equal("technical_unavailable", response.Reason);
        Assert.False(await RequiredAsync(Eligible));
        Assert.Equal("technical_unavailable", await AuditReasonAsync(Eligible));

        await ExpectFailureAsync(store, ownScope, Eligible, 409);
        await ExpectFailureAsync(store, ownScope, Started, 409);
        await ExpectFailureAsync(store, ownScope, NoLongerRequired, 409);
        await ExpectFailureAsync(store, ownScope, HasSession, 409);
        await ExpectFailureAsync(store, ownScope, Hidden, 404);
        await ExpectFailureAsync(store, Scope(AccessScope.Company), OtherTenant, 404);
        Assert.True(await RequiredAsync(Hidden));
        Assert.True(await RequiredAsync(OtherTenant));

        // The final conditional update permits only one winner under concurrent
        // staff requests; the other must see a lifecycle conflict, not a duplicate audit.
        await using var concurrentDb = NewContext();
        var concurrentStore = NewStore(concurrentDb);
        var results = await Task.WhenAll(
            TryAccommodateAsync(store, ownScope, Race),
            TryAccommodateAsync(concurrentStore, ownScope, Race));
        Assert.Contains(200, results);
        Assert.Contains(409, results);
        Assert.Equal(1L, await AuditCountAsync(Race));

        // An audit write failure rolls the assignment update back with it.
        await ExecuteAsync("ALTER TABLE audit_logs ADD CONSTRAINT fail_accommodation_audit "
            + "CHECK (action <> 'proctoring_accommodation' OR entity_id <> 'cccccccc-cccc-cccc-cccc-cccccccccc07');");
        await Assert.ThrowsAsync<DbUpdateException>(() =>
            store.AccommodateAsync(ownScope, AuditFailure, Staff, "accessibility",
                null, null, default));
        Assert.True(await RequiredAsync(AuditFailure));
        Assert.Equal(0L, await AuditCountAsync(AuditFailure));
    }

    private async Task<int> TryAccommodateAsync(StaffProctoringStore store,
        StaffProctoringScope scope, Guid assignmentId)
    {
        try
        {
            await store.AccommodateAsync(scope, assignmentId, Staff,
                "other", null, null, default);
            return 200;
        }
        catch (StaffProctoringFailure failure)
        {
            return failure.StatusCode;
        }
    }

    private static async Task ExpectFailureAsync(StaffProctoringStore store,
        StaffProctoringScope scope, Guid id, int expectedStatus)
    {
        var failure = await Assert.ThrowsAsync<StaffProctoringFailure>(() =>
            store.AccommodateAsync(scope, id, Staff, "other", null, null, default));
        Assert.Equal(expectedStatus, failure.StatusCode);
    }

    private StaffProctoringStore NewStore(ProctoringDbContext db) => new(
        db, new UnusedAnchors(), new UnusedAuditor(), new CandidateProctoringRepository(db));

    private ProctoringDbContext NewContext() => new(
        new DbContextOptionsBuilder<ProctoringDbContext>().UseNpgsql(_connectionString).Options);

    private static StaffProctoringScope Scope(AccessScope accessScope) =>
        new(Org, Staff, accessScope, [], []);

    private async Task<bool> RequiredAsync(Guid id)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT proctoring_required FROM assessment_assignments WHERE id = @id", connection);
        command.Parameters.AddWithValue("id", id);
        return (bool)(await command.ExecuteScalarAsync()
            ?? throw new InvalidOperationException("Missing assignment"));
    }

    private async Task<long> AuditCountAsync(Guid id)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT count(*) FROM audit_logs WHERE entity_id = @id", connection);
        command.Parameters.AddWithValue("id", id.ToString());
        return (long)(await command.ExecuteScalarAsync() ?? 0L);
    }

    private async Task<string> AuditReasonAsync(Guid id)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT metadata->>'reason' FROM audit_logs WHERE entity_id = @id", connection);
        command.Parameters.AddWithValue("id", id.ToString());
        return (string)(await command.ExecuteScalarAsync()
            ?? throw new InvalidOperationException("Missing accommodation audit"));
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private sealed class UnusedAnchors : IAnchorLoaderFactory
    {
        public IAnchorLoader Create(Guid organizationId, Guid userId) =>
            throw new InvalidOperationException("Test supplies resolved scope.");
    }

    private sealed class UnusedAuditor : IDataAccessAuditor
    {
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Accommodation uses the atomic audit row.");
    }

    private const string SchemaSql = """
        CREATE TABLE vacancies (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            team_id uuid, business_unit_id uuid, assigned_to uuid, created_by uuid NOT NULL,
            deleted_at timestamp(3));
        CREATE TABLE assessment_assignments (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            candidate_id uuid NOT NULL, vacancy_id uuid NOT NULL, assessment_type_id uuid NOT NULL,
            proctoring_required boolean NOT NULL, status text NOT NULL,
            started_at timestamp(3), completed_at timestamp(3), expires_at timestamp(3),
            updated_at timestamp(3) NOT NULL);
        CREATE TABLE proctoring_sessions (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            assignment_id uuid NOT NULL);
        CREATE TABLE audit_logs (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            actor_id uuid, action text NOT NULL, entity text NOT NULL, entity_id text,
            metadata jsonb, ip_address text, user_agent text, created_at timestamp(3) NOT NULL);
        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_tenant;
        DO $$ DECLARE t text; BEGIN
          FOREACH t IN ARRAY ARRAY['vacancies','assessment_assignments',
              'proctoring_sessions','audit_logs'] LOOP
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
            EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = '
                || 'NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid) WITH CHECK '
                || '(organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
          END LOOP;
        END $$;
        """;

    private const string SeedSql = """
        INSERT INTO vacancies VALUES
          ('dddddddd-dddd-dddd-dddd-dddddddddd01','11111111-1111-1111-1111-111111111111',
            NULL,NULL,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',NULL),
          ('dddddddd-dddd-dddd-dddd-dddddddddd02','11111111-1111-1111-1111-111111111111',
            NULL,NULL,NULL,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',NULL),
          ('dddddddd-dddd-dddd-dddd-dddddddddd03','22222222-2222-2222-2222-222222222222',
            NULL,NULL,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',NULL);
        INSERT INTO assessment_assignments
          (id,organization_id,candidate_id,vacancy_id,assessment_type_id,
           proctoring_required,status,updated_at)
        VALUES
          ('cccccccc-cccc-cccc-cccc-cccccccccc01','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd01',
            '99999999-9999-9999-9999-999999999999',true,'assigned',CURRENT_TIMESTAMP),
          ('cccccccc-cccc-cccc-cccc-cccccccccc02','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd02',
            '99999999-9999-9999-9999-999999999999',true,'assigned',CURRENT_TIMESTAMP),
          ('cccccccc-cccc-cccc-cccc-cccccccccc03','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd01',
            '99999999-9999-9999-9999-999999999999',true,'in_progress',CURRENT_TIMESTAMP),
          ('cccccccc-cccc-cccc-cccc-cccccccccc04','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd01',
            '99999999-9999-9999-9999-999999999999',false,'assigned',CURRENT_TIMESTAMP),
          ('cccccccc-cccc-cccc-cccc-cccccccccc05','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd01',
            '99999999-9999-9999-9999-999999999999',true,'assigned',CURRENT_TIMESTAMP),
          ('cccccccc-cccc-cccc-cccc-cccccccccc06','22222222-2222-2222-2222-222222222222',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd03',
            '99999999-9999-9999-9999-999999999999',true,'assigned',CURRENT_TIMESTAMP),
          ('cccccccc-cccc-cccc-cccc-cccccccccc07','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd01',
            '99999999-9999-9999-9999-999999999999',true,'assigned',CURRENT_TIMESTAMP),
          ('cccccccc-cccc-cccc-cccc-cccccccccc08','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddd01',
            '99999999-9999-9999-9999-999999999999',true,'assigned',CURRENT_TIMESTAMP);
        INSERT INTO proctoring_sessions VALUES
          ('88888888-8888-8888-8888-888888888888',
            '11111111-1111-1111-1111-111111111111',
            'cccccccc-cccc-cccc-cccc-cccccccccc05');
        """;
}
