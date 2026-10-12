using Microsoft.Extensions.Logging;
using Tims.Api.CvParsing;
using Tims.Infrastructure.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

/// <summary>
/// The log tokens are the alarm contract (scripts/ops/create-cv-recovery-alarm.sh):
/// a heartbeat on every healthy tick lets a "heartbeat missing" alarm detect a
/// stalled loop, and the alert token is emitted only while a condition is CURRENT,
/// so the alert alarm returns to OK once it clears.
/// </summary>
public sealed class CvRecoveryHealthTests
{
    [Fact]
    public void Healthy_tick_emits_only_the_heartbeat()
    {
        var log = new CapturingLogger();
        Assert.False(CvParseRecoveryHostedService.ReportHealth(log, new CvRecoveryStats(3, 1, 0, 0, 0, 120), 0));
        Assert.Single(log.Lines, line => line.StartsWith("CV_RECOVERY_HEARTBEAT", StringComparison.Ordinal));
        Assert.DoesNotContain(log.Lines, line => line.Contains("CV_RECOVERY_ALERT", StringComparison.Ordinal));
    }

    [Fact]
    public void Old_terminal_documents_no_longer_hold_the_alert()
    {
        var log = new CapturingLogger();
        // 7 exhausted all-time, none recently: previously this alerted on every tick forever.
        Assert.False(CvParseRecoveryHostedService.ReportHealth(log, new CvRecoveryStats(0, 0, 7, 0, 2, 0), 0));
        Assert.DoesNotContain(log.Lines, line => line.Contains("CV_RECOVERY_ALERT", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(1, 0, 0)]
    [InlineData(0, 601, 0)]
    [InlineData(0, 0, 1)]
    public void Current_problem_emits_heartbeat_and_alert(long recent, long oldestDue, int stuck)
    {
        var log = new CapturingLogger();
        Assert.True(CvParseRecoveryHostedService.ReportHealth(log,
            new CvRecoveryStats(1, 0, recent, recent, 0, oldestDue), stuck));
        Assert.Contains(log.Lines, line => line.StartsWith("CV_RECOVERY_HEARTBEAT", StringComparison.Ordinal));
        Assert.Contains(log.Lines, line => line.StartsWith("CV_RECOVERY_ALERT", StringComparison.Ordinal));
    }

    private sealed class CapturingLogger : ILogger
    {
        public List<string> Lines { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Lines.Add(formatter(state, exception));
    }
}
