using System.Net;
using Npgsql;
using Tims.Application.Audit;
using Tims.Domain.Audit;

namespace Tims.IntegrationTests.Compensation;

public sealed partial class CompensationReadEndpointAuthTests
{
    [Theory]
    [InlineData("employee")]
    [InlineData("self")]
    [InlineData("simulation")]
    public async Task SalaryResponseWaitsForAuditCompletion(string endpoint)
    {
        var self = endpoint == "self";
        var auditor = new ControlledAuditor();
        await using var factory = EnabledFactory(auditor);
        using var client = factory.CreateClient();
        var responseTask = Get(client, SalaryPath(endpoint),
            Mint(self ? CompensationReadFixture.EmpSub : CompensationReadFixture.OrgHrSub));
        try
        {
            var audit = await auditor.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            Assert.False(responseTask.IsCompleted);
            Assert.Equal(CompensationReadFixture.OrgA.ToString(), audit.OrganizationId);
            Assert.Equal((self ? CompensationReadFixture.EmpId : CompensationReadFixture.OrgHrId).ToString(), audit.ActorId);
            Assert.Equal("employeeCompensation", audit.Entity);
            Assert.Equal(self ? "9c000000-0000-0000-0000-000000000005" : "9c000000-0000-0000-0000-000000000001", audit.RecordId);
            Assert.Equal(AuditAction.Read, audit.Action);
            Assert.True(auditor.FailClosed);
        }
        finally { auditor.Release.TrySetResult(); }
        using var response = await responseTask;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("currentSalary", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("employee")]
    [InlineData("self")]
    [InlineData("simulation")]
    public async Task AuditFailureDoesNotReturnSalary(string endpoint)
    {
        var self = endpoint == "self";
        var auditor = new ControlledAuditor();
        auditor.Release.SetException(new AuditWriteFailedException(new InvalidOperationException("synthetic audit outage")));
        await using var factory = EnabledFactory(auditor);
        using var client = factory.CreateClient();
        var responseTask = Get(client, SalaryPath(endpoint),
            Mint(self ? CompensationReadFixture.EmpSub : CompensationReadFixture.OrgHrSub));
        await auditor.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(auditor.FailClosed);
        // TestServer may propagate the exception; a host error response must also contain no salary DTO.
        try
        {
            using var response = await responseTask;
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.DoesNotContain("\"currentSalary\":", await response.Content.ReadAsStringAsync());
        }
        catch (AuditWriteFailedException) { }
    }

    [Theory]
    [InlineData("employee")]
    [InlineData("self")]
    [InlineData("simulation")]
    public async Task SalaryReadPersistsAnAuditForItsExactRecord(string endpoint)
    {
        var self = endpoint == "self";
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var marker = $"compensation-audit-{Guid.NewGuid():N}";
        client.DefaultRequestHeaders.UserAgent.ParseAdd(marker);
        using var response = await Get(client, SalaryPath(endpoint),
            Mint(self ? CompensationReadFixture.EmpSub : CompensationReadFixture.OrgHrSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            SELECT organization_id, actor_id, data_type, record_id, action
            FROM data_access_logs WHERE user_agent = @marker
            """, connection);
        command.Parameters.AddWithValue("marker", marker);
        await using var rows = await command.ExecuteReaderAsync();
        Assert.True(await rows.ReadAsync());
        Assert.Equal(CompensationReadFixture.OrgA, rows.GetGuid(0));
        Assert.Equal(self ? CompensationReadFixture.EmpId : CompensationReadFixture.OrgHrId, rows.GetGuid(1));
        Assert.Equal("employeeCompensation", rows.GetString(2));
        Assert.Equal(Guid.Parse(self ? "9c000000-0000-0000-0000-000000000005" : "9c000000-0000-0000-0000-000000000001"), rows.GetGuid(3));
        Assert.Equal("read", rows.GetString(4));
        Assert.False(await rows.ReadAsync());
    }

    private static string SalaryPath(string endpoint) => endpoint switch
    {
        "self" => MyCompensation,
        "simulation" => $"/compensation/simulate-adjustment?userId={CompensationReadFixture.M1Id}&proposedSalary=99000&currency=USD",
        _ => Employee(CompensationReadFixture.M1Id),
    };

    private sealed class ControlledAuditor : IDataAccessAuditor
    {
        public TaskCompletionSource<DataAccessEvent> Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool? FailClosed { get; private set; }
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default)
        {
            FailClosed = failClosed;
            Entered.TrySetResult(auditEvent);
            return Release.Task;
        }
    }
}
