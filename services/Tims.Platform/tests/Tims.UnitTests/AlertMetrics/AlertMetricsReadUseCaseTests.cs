using Tims.Application.AlertMetrics;
using Tims.Application.Audit;
using Tims.Domain.AlertMetrics;

namespace Tims.UnitTests.AlertMetrics;

/// <summary>
/// The use case that composes the read, the §21 floor and the audit row (#172). Over fakes — no DB, no
/// HTTP — so the three behaviours that carry the security properties are asserted directly:
/// the floor is applied server-side, the sub-floor COUNT never leaves the process (not even into the
/// audit metadata), and every cross-org read is audited.
/// </summary>
public sealed class AlertMetricsReadUseCaseTests
{
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private sealed class FakeRepository(int surveys, int adjustments) : IAlertMetricsReadRepository
    {
        public Task<int> CountActiveSurveysAsync(Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult(surveys);

        public Task<int> CountPendingSalaryAdjustmentsAsync(Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult(adjustments);
    }

    private sealed class RecordingSecurityEventWriter : ISecurityEventWriter
    {
        public List<SecurityEvent> Events { get; } = [];

        public Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken)
        {
            Events.Add(securityEvent);
            return Task.CompletedTask;
        }
    }

    private static (AlertMetricsReadUseCase UseCase, RecordingSecurityEventWriter Audit) Build(
        int surveys = 0, int adjustments = 0)
    {
        var audit = new RecordingSecurityEventWriter();
        return (new AlertMetricsReadUseCase(new FakeRepository(surveys, adjustments), audit), audit);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(5, 5)]
    [InlineData(9, 9)]
    public async Task Sensitive_metric_at_or_above_floor_returns_the_value(int raw, int expected)
    {
        var (useCase, _) = Build(adjustments: raw);

        var outcome = await useCase.ComputeAsync(Org, AlertMetric.PendingSalaryAdjustments, default);

        var value = Assert.IsType<AlertMetricOutcome.Value>(outcome);
        Assert.Equal(expected, value.Count);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public async Task Sensitive_metric_below_floor_is_suppressed_and_carries_no_count(int raw)
    {
        var (useCase, _) = Build(adjustments: raw);

        var outcome = await useCase.ComputeAsync(Org, AlertMetric.PendingSalaryAdjustments, default);

        // The TYPE itself is what guarantees no number escapes: Suppressed has no Count member, so a
        // sub-floor value cannot be serialized even by a careless endpoint change.
        Assert.IsType<AlertMetricOutcome.Suppressed>(outcome);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(4)]
    public async Task Non_sensitive_metric_is_never_floored(int raw)
    {
        // The failure this catches is the plausible over-correction: flooring EVERYTHING would silently
        // stop `active_surveys` alerting for every org with fewer than five active surveys.
        var (useCase, _) = Build(surveys: raw);

        var outcome = await useCase.ComputeAsync(Org, AlertMetric.ActiveSurveys, default);

        var value = Assert.IsType<AlertMetricOutcome.Value>(outcome);
        Assert.Equal(raw, value.Count);
    }

    [Fact]
    public async Task Every_cross_org_read_writes_one_audit_row_attributed_to_the_org_with_a_null_actor()
    {
        var (useCase, audit) = Build(surveys: 3);

        await useCase.ComputeAsync(Org, AlertMetric.ActiveSurveys, default);

        var row = Assert.Single(audit.Events);
        Assert.Equal(Org, row.OrganizationId);
        Assert.Null(row.ActorId); // a machine caller — never a fabricated sentinel user
        Assert.Equal(AlertMetricsReadUseCase.AuditAction, row.Action);
        Assert.Equal(AlertMetricsReadUseCase.AuditEntity, row.Entity);
        Assert.Equal(AlertMetricKeys.ActiveSurveys, row.EntityId);
    }

    [Fact]
    public async Task A_suppressed_read_is_still_audited_and_the_metadata_carries_no_count()
    {
        var (useCase, audit) = Build(adjustments: 3);

        await useCase.ComputeAsync(Org, AlertMetric.PendingSalaryAdjustments, default);

        var row = Assert.Single(audit.Events);
        var metadata = row.Metadata!.ToJsonString();

        Assert.Contains("\"outcome\":\"suppressed\"", metadata, StringComparison.Ordinal);
        Assert.Contains("\"sensitive\":true", metadata, StringComparison.Ordinal);

        // The whole point of the floor is that the sub-floor count does not survive anywhere. audit_logs
        // is read by auditors, so leaking it here would recreate the disclosure in a durable table.
        Assert.DoesNotContain("3", metadata, StringComparison.Ordinal);
    }

    private sealed class ThrowingRepository : IAlertMetricsReadRepository
    {
        public Task<int> CountActiveSurveysAsync(Guid organizationId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");

        public Task<int> CountPendingSalaryAdjustmentsAsync(Guid organizationId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("db down");
    }

    [Fact]
    public async Task A_FAILED_cross_org_read_is_still_audited_and_the_exception_still_propagates()
    {
        // The finding a review panel raised: the first version audited only on the success path, so a
        // read that reached the database and then threw left NO trace — while the PR claimed "every
        // cross-org read writes an audit row". A secret-holder enumerating orgs against a degraded DB
        // was invisible. The failure is also the event an auditor most wants to see.
        var audit = new RecordingSecurityEventWriter();
        var useCase = new AlertMetricsReadUseCase(new ThrowingRepository(), audit);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => useCase.ComputeAsync(Org, AlertMetric.ActiveSurveys, default));

        var row = Assert.Single(audit.Events);
        Assert.Equal(Org, row.OrganizationId);
        Assert.Contains("\"outcome\":\"failed\"", row.Metadata!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_failing_audit_write_never_masks_the_read_or_its_exception()
    {
        // The audit is fail-SOFT by contract. Assert it here too: a writer that throws must not convert a
        // good read into an error, nor replace the original exception on the failing path.
        var useCase = new AlertMetricsReadUseCase(new FakeRepository(7, 0), new ThrowingSecurityEventWriter());

        var outcome = await useCase.ComputeAsync(Org, AlertMetric.ActiveSurveys, default);

        Assert.Equal(7, Assert.IsType<AlertMetricOutcome.Value>(outcome).Count);
    }

    private sealed class ThrowingSecurityEventWriter : ISecurityEventWriter
    {
        public Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("audit sink down");
    }

    [Fact]
    public async Task The_audit_row_carries_the_callers_ip_and_user_agent_when_supplied()
    {
        // On a surface whose entire authorization boundary is a shared secret, these are the only fields
        // that could distinguish the real cron from someone who obtained that secret.
        var (useCase, audit) = Build(surveys: 2);

        await useCase.ComputeAsync(Org, AlertMetric.ActiveSurveys, default, "203.0.113.7", "tims-cron/1.0");

        var row = Assert.Single(audit.Events);
        Assert.Equal("203.0.113.7", row.IpAddress);
        Assert.Equal("tims-cron/1.0", row.UserAgent);
    }

    [Fact]
    public async Task Audit_records_the_org_that_was_read_not_a_fixed_one()
    {
        // Guards the cross-org attribution: the caller names the org, so an implementation that logged a
        // constant (or the first org seen) would make every row in a platform-wide run indistinguishable.
        var other = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var (useCase, audit) = Build(surveys: 7);

        await useCase.ComputeAsync(Org, AlertMetric.ActiveSurveys, default);
        await useCase.ComputeAsync(other, AlertMetric.ActiveSurveys, default);

        Assert.Equal([Org, other], audit.Events.Select(e => e.OrganizationId).ToArray());
    }
}
