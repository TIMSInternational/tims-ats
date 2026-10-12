using Tims.Application.PlatformHealth;

namespace Tims.UnitTests.PlatformHealth;

/// <summary>
/// Every threshold behind the Health page's dependency rows. The rule under test throughout: a state is only
/// reported when the probe established it — an ambiguous answer is not_monitored, never a guessed green or red.
/// </summary>
public sealed class DependencyHealthClassifierTests
{
    // ── SES ───────────────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public void Ses_SendingEnabled_WithHeadroom_IsOperational_WithQuotaMetrics()
    {
        var result = DependencyHealthClassifier.ClassifySes(true, 50000, 1200, 40);

        Assert.Equal(DependencyStatus.Operational, result.Status);
        Assert.Null(result.Reason);
        Assert.Equal(40, result.LatencyMs);
        Assert.Equal("1200", Metric(result, "sent_last_24h"));
        Assert.Equal("50000", Metric(result, "max_24h_send"));
        Assert.Equal("2.4", Metric(result, "quota_used_pct"));
    }

    [Fact]
    public void Ses_SendingPaused_IsDown_EvenWithHeadroom()
    {
        var result = DependencyHealthClassifier.ClassifySes(false, 50000, 0, 10);

        Assert.Equal(DependencyStatus.Down, result.Status);
        Assert.Equal(DependencyReason.SendingPaused, result.Reason);
    }

    [Theory]
    [InlineData(799, DependencyStatus.Operational, null)]
    [InlineData(800, DependencyStatus.Degraded, DependencyReason.QuotaNearLimit)] // exactly 80% → degraded
    [InlineData(999, DependencyStatus.Degraded, DependencyReason.QuotaNearLimit)]
    [InlineData(1000, DependencyStatus.Down, DependencyReason.QuotaExhausted)] // exactly the cap → down
    [InlineData(1200, DependencyStatus.Down, DependencyReason.QuotaExhausted)]
    public void Ses_QuotaBoundaries(double sent, string status, string? reason)
    {
        var result = DependencyHealthClassifier.ClassifySes(true, 1000, sent, 1);

        Assert.Equal(status, result.Status);
        Assert.Equal(reason, result.Reason);
    }

    [Fact]
    public void Ses_UnknownSendingState_IsNotMonitored_NotOperational()
    {
        var result = DependencyHealthClassifier.ClassifySes(null, 1000, 1, 1);

        Assert.Equal(DependencyStatus.NotMonitored, result.Status);
        Assert.Equal(DependencyReason.ProbeFailed, result.Reason);
    }

    [Theory]
    [InlineData(-1.0)]
    [InlineData(0.0)]
    public void Ses_NoUsableCap_MakesNoHeadroomClaim(double max)
    {
        var result = DependencyHealthClassifier.ClassifySes(true, max, 5, 1);

        Assert.Equal(DependencyStatus.Operational, result.Status);
        Assert.Null(Metric(result, "max_24h_send"));
        Assert.DoesNotContain(result.Metrics, metric => metric.Id == "quota_used_pct");
    }

    // ── Bedrock guardrail ─────────────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData("READY", DependencyStatus.Operational, null)]
    [InlineData("CREATING", DependencyStatus.Degraded, DependencyReason.GuardrailNotReady)]
    [InlineData("UPDATING", DependencyStatus.Degraded, DependencyReason.GuardrailNotReady)]
    [InlineData("VERSIONING", DependencyStatus.Degraded, DependencyReason.GuardrailNotReady)]
    [InlineData("FAILED", DependencyStatus.Down, DependencyReason.GuardrailFailed)]
    [InlineData("DELETING", DependencyStatus.Down, DependencyReason.GuardrailFailed)]
    [InlineData("SOMETHING_NEW", DependencyStatus.NotMonitored, DependencyReason.ProbeFailed)]
    [InlineData(null, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed)]
    public void Guardrail_States(string? state, string status, string? reason)
    {
        var result = DependencyHealthClassifier.ClassifyGuardrail(state, 7);

        Assert.Equal(DependencyIds.Ai, result.Id);
        Assert.Equal(status, result.Status);
        Assert.Equal(reason, result.Reason);
    }

    [Fact]
    public void Guardrail_StatusMetric_IsAClosedToken_NeverArbitraryText()
    {
        Assert.Equal("ready", Metric(DependencyHealthClassifier.ClassifyGuardrail("READY", 1), "guardrail_status"));
        Assert.Null(Metric(DependencyHealthClassifier.ClassifyGuardrail("arn:aws:bedrock:x", 1), "guardrail_status"));
    }

    // ── Supabase Auth ─────────────────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(200, DependencyStatus.Operational, null)]
    [InlineData(204, DependencyStatus.Operational, null)]
    [InlineData(401, DependencyStatus.NotMonitored, DependencyReason.AccessDenied)] // OUR key refused ≠ service down
    [InlineData(403, DependencyStatus.NotMonitored, DependencyReason.AccessDenied)]
    [InlineData(404, DependencyStatus.Degraded, DependencyReason.ErrorStatus)]
    [InlineData(429, DependencyStatus.Degraded, DependencyReason.ErrorStatus)]
    [InlineData(500, DependencyStatus.Down, DependencyReason.ErrorStatus)]
    [InlineData(503, DependencyStatus.Down, DependencyReason.ErrorStatus)]
    public void AuthHealth_ByStatusCode(int code, string status, string? reason)
    {
        var result = DependencyHealthClassifier.ClassifyAuthHealth(code, 3);

        Assert.Equal(status, result.Status);
        Assert.Equal(reason, result.Reason);
    }

    // ── CV bucket ─────────────────────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(404, DependencyStatus.Down, DependencyReason.NotFound)]
    [InlineData(301, DependencyStatus.Down, DependencyReason.Misconfigured)]
    [InlineData(400, DependencyStatus.Down, DependencyReason.Misconfigured)]
    [InlineData(403, DependencyStatus.NotMonitored, DependencyReason.AccessDenied)]
    [InlineData(500, DependencyStatus.Down, DependencyReason.ErrorStatus)]
    [InlineData(409, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed)]
    public void Bucket_ErrorsByStatusCode(int code, string status, string reason)
    {
        var result = DependencyHealthClassifier.ClassifyBucketError(code, 3);

        Assert.Equal(DependencyIds.Storage, result.Id);
        Assert.Equal(status, result.Status);
        Assert.Equal(reason, result.Reason);
    }

    // ── Worker heartbeat ──────────────────────────────────────────────────────────────────────────────
    private static readonly DateTimeOffset Now = new(2026, 10, 12, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Workers_NoHeartbeatStore_IsNotDeployed_NeverOperational()
    {
        var result = DependencyHealthClassifier.ClassifyWorkerHeartbeat(false, 0, null, null, Now, 2);

        Assert.Equal(DependencyStatus.NotMonitored, result.Status);
        Assert.Equal(DependencyReason.NotDeployed, result.Reason);
    }

    [Fact]
    public void Workers_EmptyHeartbeatStore_IsNotDeployed()
    {
        var result = DependencyHealthClassifier.ClassifyWorkerHeartbeat(true, 0, null, null, Now, 2);

        Assert.Equal(DependencyStatus.NotMonitored, result.Status);
        Assert.Equal(DependencyReason.NotDeployed, result.Reason);
    }

    [Fact]
    public void Workers_FreshHeartbeat_IsOperational()
    {
        var last = Now.AddSeconds(-12).ToUnixTimeMilliseconds();
        var result = DependencyHealthClassifier.ClassifyWorkerHeartbeat(true, 2, last, 10_000, Now, 2);

        Assert.Equal(DependencyStatus.Operational, result.Status);
        Assert.Equal("2", Metric(result, "worker_nodes"));
        Assert.Equal("12", Metric(result, "heartbeat_age_s"));
    }

    [Theory]
    // 10s interval → threshold is the 60s floor (3 × 10s = 30s is below it).
    [InlineData(10_000, 60, DependencyStatus.Operational)]
    [InlineData(10_000, 61, DependencyStatus.Down)]
    // 30s interval → threshold is 3 × 30s = 90s.
    [InlineData(30_000, 90, DependencyStatus.Operational)]
    [InlineData(30_000, 91, DependencyStatus.Down)]
    public void Workers_StalenessThreshold_IsMaxOfFloorAndThreeIntervals(long intervalMs, int ageSeconds, string status)
    {
        var last = Now.AddSeconds(-ageSeconds).ToUnixTimeMilliseconds();
        var result = DependencyHealthClassifier.ClassifyWorkerHeartbeat(true, 1, last, intervalMs, Now, 2);

        Assert.Equal(status, result.Status);
        if (status == DependencyStatus.Down)
        {
            Assert.Equal(DependencyReason.HeartbeatStale, result.Reason);
        }
    }

    private static string? Metric(DependencyProbeResult result, string id) =>
        result.Metrics.SingleOrDefault(metric => metric.Id == id)?.Value;
}
