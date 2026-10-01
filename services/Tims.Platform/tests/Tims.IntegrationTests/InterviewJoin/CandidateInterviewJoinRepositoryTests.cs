using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.InterviewJoin;
using Tims.Infrastructure.InterviewJoin;

namespace Tims.IntegrationTests.InterviewJoin;

[Collection("CandidateInterviewJoinRepository")]
public sealed class CandidateInterviewJoinRepositoryTests(CandidateInterviewJoinRepositoryFixture fixture)
{
    [Fact]
    public async Task Resolves_the_interview_and_candidate_by_token_hash_only()
    {
        var seeded = await fixture.SeedAsync();
        var interview = await fixture.Repository().FindByTokenHashAsync(seeded.Hash, default);
        Assert.NotNull(interview);
        Assert.Equal((seeded.InterviewId, seeded.OrganizationId, "video", "scheduled", 45),
            (interview!.Id, interview.OrganizationId, interview.Type, interview.Status, interview.DurationMinutes));
        Assert.Equal(("Ana", "Pérez"), (interview.CandidateFirstName, interview.CandidateLastName));
        Assert.Equal(DateTimeKind.Utc, interview.ScheduledAt.Kind);
        Assert.Null(await fixture.Repository().FindByTokenHashAsync(new string('0', 64), default));
    }

    [Fact]
    public async Task A_soft_deleted_or_other_org_candidate_resolves_to_nothing()
    {
        var deleted = await fixture.SeedAsync();
        Assert.NotNull(await fixture.Repository().FindByTokenHashAsync(deleted.Hash, default));
        await fixture.ExecuteAsync($"UPDATE candidates SET deleted_at=now() WHERE id=(SELECT candidate_id FROM interviews WHERE id='{deleted.InterviewId}')");
        Assert.Null(await fixture.Repository().FindByTokenHashAsync(deleted.Hash, default));

        var foreign = await fixture.SeedAsync();
        await fixture.ExecuteAsync($"UPDATE candidates SET organization_id='{Guid.NewGuid()}' WHERE id=(SELECT candidate_id FROM interviews WHERE id='{foreign.InterviewId}')");
        Assert.Null(await fixture.Repository().FindByTokenHashAsync(foreign.Hash, default));
    }

    [Fact]
    public async Task A_live_interview_with_no_application_is_neither_closed_nor_inactive()
    {
        var seeded = await fixture.SeedAsync();
        var interview = await fixture.Repository().FindByTokenHashAsync(seeded.Hash, default);
        Assert.Equal((false, false), (interview!.ApplicationClosed, interview.OrganizationInactive));
    }

    [Theory]
    [InlineData("UPDATE organizations SET is_active=false WHERE id='{org}'")]
    [InlineData("UPDATE organizations SET deleted_at=now() WHERE id='{org}'")]
    [InlineData("DELETE FROM organizations WHERE id='{org}'")]
    public async Task A_suspended_deleted_or_missing_organization_is_reported_inactive(string mutation)
    {
        // #329 item 5 — the same predicate the API-key lockout uses (is_active AND deleted_at IS NULL).
        var seeded = await fixture.SeedAsync();
        await fixture.ExecuteAsync(mutation.Replace("{org}", seeded.OrganizationId.ToString()));
        var interview = await fixture.Repository().FindByTokenHashAsync(seeded.Hash, default);
        Assert.True(interview!.OrganizationInactive);
        Assert.False(interview.ApplicationClosed);
    }

    [Theory]
    [InlineData("active", false, false)]
    [InlineData("hired", false, false)]
    [InlineData("rejected", false, true)]
    [InlineData("withdrawn", false, true)]
    [InlineData("active", true, true)] // rejected_at set without the status flip still revokes
    public async Task A_rejected_or_withdrawn_application_is_reported_closed(string status, bool rejectedAt,
        bool expectedClosed)
    {
        var seeded = await fixture.SeedAsync();
        var application = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO applications(id,organization_id,status,rejected_at) VALUES('{application}','{seeded.OrganizationId}','{status}',{(rejectedAt ? "now()" : "NULL")});" +
            $"UPDATE interviews SET application_id='{application}' WHERE id='{seeded.InterviewId}'");
        var interview = await fixture.Repository().FindByTokenHashAsync(seeded.Hash, default);
        Assert.Equal(expectedClosed, interview!.ApplicationClosed);
    }

    [Fact]
    public async Task An_application_that_no_longer_resolves_in_the_interviews_org_is_closed_fail_closed()
    {
        var seeded = await fixture.SeedAsync();
        var foreignApplication = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"INSERT INTO applications(id,organization_id) VALUES('{foreignApplication}','{Guid.NewGuid()}');" +
            $"UPDATE interviews SET application_id='{foreignApplication}' WHERE id='{seeded.InterviewId}'");
        Assert.True((await fixture.Repository().FindByTokenHashAsync(seeded.Hash, default))!.ApplicationClosed);

        await fixture.ExecuteAsync($"UPDATE interviews SET application_id='{Guid.NewGuid()}' WHERE id='{seeded.InterviewId}'");
        Assert.True((await fixture.Repository().FindByTokenHashAsync(seeded.Hash, default))!.ApplicationClosed);
    }

    [Fact]
    public async Task A_legacy_room_stored_by_an_interview_in_another_tenant_is_shared()
    {
        // #329 item 1 — the collision is CROSS-tenant, so the check is too.
        var room = "tims-" + Guid.NewGuid().ToString("N")[..8];
        var mine = await fixture.SeedAsync();
        var theirs = await fixture.SeedAsync();
        await fixture.ExecuteAsync($"UPDATE interviews SET meeting_url='https://tims.daily.co/{room}' WHERE id='{mine.InterviewId}'");
        Assert.False(await fixture.Repository().IsRoomSharedAsync(mine.InterviewId, room, default));

        // Another tenant's row names the same room, spelled differently (case, query) — still the same room.
        await fixture.ExecuteAsync($"UPDATE interviews SET meeting_url='https://TIMS.daily.co/{room.ToUpperInvariant()}?x=1' WHERE id='{theirs.InterviewId}'");
        Assert.NotEqual(mine.OrganizationId, theirs.OrganizationId);
        Assert.True(await fixture.Repository().IsRoomSharedAsync(mine.InterviewId, room, default));
        Assert.True(await fixture.Repository().IsRoomSharedAsync(theirs.InterviewId, room, default));
    }

    [Fact]
    public async Task A_collision_check_that_cannot_see_the_interviews_own_row_fails_closed()
    {
        // If the connection cannot see this interview's own row (e.g. a non-BYPASSRLS login under forced RLS), "no
        // other row" is a blind answer, so it is reported as shared.
        var room = "tims-" + Guid.NewGuid().ToString("N")[..8];
        var seeded = await fixture.SeedAsync();
        Assert.True(await fixture.Repository().IsRoomSharedAsync(seeded.InterviewId, room, default));
    }

    [Fact]
    public async Task Meeting_url_claim_is_tenant_filtered_and_first_writer_wins()
    {
        var seeded = await fixture.SeedAsync();
        var repository = fixture.Repository();
        // Wrong organization: RLS + the WHERE org filter both refuse; nothing is written or read back.
        Assert.Null(await repository.ClaimMeetingUrlAsync(seeded.InterviewId, Guid.NewGuid(),
            "https://tims.daily.co/cross-tenant", default));
        Assert.Null(await fixture.MeetingUrlAsync(seeded.InterviewId));

        Assert.Equal("https://tims.daily.co/first", await repository.ClaimMeetingUrlAsync(seeded.InterviewId,
            seeded.OrganizationId, "https://tims.daily.co/first", default));
        Assert.Equal("https://tims.daily.co/first", await repository.ClaimMeetingUrlAsync(seeded.InterviewId,
            seeded.OrganizationId, "https://tims.daily.co/second", default));
        Assert.Equal("https://tims.daily.co/first", await fixture.MeetingUrlAsync(seeded.InterviewId));
    }

    [Fact]
    public async Task Meeting_url_claim_org_predicate_holds_even_with_rls_disabled()
    {
        // RLS off, so the ONLY thing refusing a wrong-organization claim is the WHERE organization_id filter.
        // (The test above cannot tell the two apart: RLS alone would make it pass.)
        var seeded = await fixture.SeedAsync();
        await fixture.ExecuteAsync("ALTER TABLE interviews NO FORCE ROW LEVEL SECURITY; ALTER TABLE interviews DISABLE ROW LEVEL SECURITY");
        try
        {
            var wrongOrg = Guid.NewGuid();
            Assert.Null(await fixture.Repository().ClaimMeetingUrlAsync(seeded.InterviewId, wrongOrg,
                "https://tims.daily.co/cross-tenant", default));
            Assert.Null(await fixture.MeetingUrlAsync(seeded.InterviewId));
        }
        finally
        {
            await fixture.ExecuteAsync("ALTER TABLE interviews ENABLE ROW LEVEL SECURITY; ALTER TABLE interviews FORCE ROW LEVEL SECURITY");
        }
    }

    [Fact]
    public async Task Join_audit_is_tenant_scoped_and_never_contains_the_token()
    {
        var seeded = await fixture.SeedAsync();
        Assert.True(await fixture.Repository().RecordAsync(new(seeded.InterviewId, seeded.OrganizationId,
            CandidateJoinOutcomes.Ready, "203.0.113.5", "browser"), default));
        var row = await fixture.AuditAsync(seeded.InterviewId);
        Assert.Equal((seeded.OrganizationId, "candidate_interview_join", "interview"), (row.Org, row.Action, row.Entity));
        Assert.Contains("\"outcome\": \"ready\"", row.Metadata);
        Assert.DoesNotContain(seeded.Token, row.Metadata);
        Assert.DoesNotContain(seeded.Hash, row.Metadata);
    }

    [Fact]
    public async Task Join_audit_attribution_is_normalized_like_every_security_audit_row()
    {
        var seeded = await fixture.SeedAsync();
        Assert.True(await fixture.Repository().RecordAsync(new(seeded.InterviewId, seeded.OrganizationId,
            CandidateJoinOutcomes.Ready, "10.0.0.1, 6.6.6.6", "agent\u2028Forged: line\u202E"), default));
        Assert.Equal((null, "agentForged: line"), await fixture.AttributionAsync(seeded.InterviewId));
    }

    [Fact]
    public async Task A_collision_check_that_throws_anything_fails_closed()
    {
        // Review LOW-8: not only NpgsqlException — a disposed data source throws ObjectDisposedException.
        var dataSource = NpgsqlDataSource.Create(fixture.ConnectionString);
        await dataSource.DisposeAsync();
        var repository = new CandidateInterviewJoinRepository(new(dataSource),
            NullLogger<CandidateInterviewJoinRepository>.Instance);
        Assert.True(await repository.IsRoomSharedAsync(Guid.NewGuid(), "tims-1234abcd", default));
    }

    [Fact]
    public async Task Audit_failure_returns_false_instead_of_throwing()
    {
        var seeded = await fixture.SeedAsync();
        await fixture.ExecuteAsync("REVOKE INSERT ON audit_logs FROM app_tenant");
        try
        {
            Assert.False(await fixture.Repository().RecordAsync(new(seeded.InterviewId, seeded.OrganizationId,
                CandidateJoinOutcomes.Ready, null, null), default));
        }
        finally
        {
            await fixture.ExecuteAsync("GRANT INSERT ON audit_logs TO app_tenant");
        }
    }
}

public sealed class CandidateInterviewJoinRepositoryFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("interview_join").WithUsername("postgres").WithPassword("postgres").Build();
    private string _connectionString = "";

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
        await ExecuteAsync(Schema);
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    public CandidateInterviewJoinRepository Repository() => new(
        new(NpgsqlDataSource.Create(_connectionString)), NullLogger<CandidateInterviewJoinRepository>.Instance);

    public async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<(Guid InterviewId, Guid OrganizationId, string Token, string Hash)> SeedAsync()
    {
        var org = Guid.NewGuid(); var candidate = Guid.NewGuid(); var interview = Guid.NewGuid();
        var token = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var hash = CandidateInterviewJoin.HashToken(token);
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO organizations(id) VALUES(@org);
            INSERT INTO candidates(id,organization_id,first_name,last_name) VALUES(@candidate,@org,'Ana','Pérez');
            INSERT INTO interviews(id,organization_id,candidate_id,type,status,scheduled_at,duration,
              candidate_join_token_hash,candidate_join_token_expires_at,updated_at)
            VALUES(@interview,@org,@candidate,'video','scheduled',now()+interval '1 day',45,@hash,
              now()+interval '1 day 75 minutes',now());
            """, connection);
        command.Parameters.AddWithValue("candidate", candidate); command.Parameters.AddWithValue("org", org);
        command.Parameters.AddWithValue("interview", interview); command.Parameters.AddWithValue("hash", hash);
        await command.ExecuteNonQueryAsync();
        return (interview, org, token, hash);
    }

    public async Task<string?> MeetingUrlAsync(Guid interviewId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT meeting_url FROM interviews WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", interviewId);
        return await command.ExecuteScalarAsync() as string;
    }

    public string ConnectionString => _connectionString;

    public async Task<(string? Ip, string? Ua)> AttributionAsync(Guid interviewId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT ip_address,user_agent FROM audit_logs WHERE entity_id=@id", connection);
        command.Parameters.AddWithValue("id", interviewId.ToString());
        await using var reader = await command.ExecuteReaderAsync(); Assert.True(await reader.ReadAsync());
        return (reader.IsDBNull(0) ? null : reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1));
    }

    public async Task<(Guid Org, string Action, string Entity, string Metadata)> AuditAsync(Guid interviewId)
    {
        await using var connection = new NpgsqlConnection(_connectionString); await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT organization_id,action,entity,metadata::text FROM audit_logs WHERE entity_id=@id", connection);
        command.Parameters.AddWithValue("id", interviewId.ToString());
        await using var reader = await command.ExecuteReaderAsync(); Assert.True(await reader.ReadAsync());
        return (reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3));
    }

    private const string Schema = """
        CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; GRANT app_tenant TO postgres;
        CREATE TABLE organizations(id uuid PRIMARY KEY,is_active boolean NOT NULL DEFAULT true,deleted_at timestamp(3));
        CREATE TABLE applications(id uuid PRIMARY KEY,organization_id uuid NOT NULL,status text NOT NULL DEFAULT 'active',
          rejected_at timestamp(3));
        CREATE TABLE candidates(id uuid PRIMARY KEY,organization_id uuid NOT NULL,first_name text NOT NULL,last_name text NOT NULL,deleted_at timestamp(3));
        CREATE TABLE interviews(id uuid PRIMARY KEY,organization_id uuid NOT NULL,candidate_id uuid NOT NULL REFERENCES candidates(id),
          application_id uuid,type text NOT NULL,status text NOT NULL DEFAULT 'scheduled',scheduled_at timestamp(3) NOT NULL,duration int NOT NULL,
          meeting_url text,cancelled_at timestamp(3),candidate_join_token_hash varchar(64) UNIQUE,
          candidate_join_token_expires_at timestamp(3),updated_at timestamp(3) NOT NULL);
        CREATE TABLE audit_logs(id uuid PRIMARY KEY,organization_id uuid NOT NULL,user_id uuid,actor_id uuid,action text NOT NULL,
          entity text NOT NULL,entity_id text,changes jsonb,metadata jsonb,ip_address text,user_agent text,
          created_at timestamp(3) NOT NULL DEFAULT now());
        GRANT SELECT,INSERT,UPDATE,DELETE ON interviews,candidates TO app_tenant;
        GRANT SELECT,INSERT ON audit_logs TO app_tenant;
        ALTER TABLE interviews ENABLE ROW LEVEL SECURITY; ALTER TABLE interviews FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON interviews USING(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid)
          WITH CHECK(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid);
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON audit_logs USING(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid)
          WITH CHECK(organization_id=NULLIF(current_setting('app.current_org_id',true),'')::uuid);
        """;
}

[CollectionDefinition("CandidateInterviewJoinRepository")]
public sealed class CandidateInterviewJoinRepositoryCollection : ICollectionFixture<CandidateInterviewJoinRepositoryFixture>;
