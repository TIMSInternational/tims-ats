using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Tims.Workers;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// WP4.1 — <see cref="WorkerOptions"/> validates at startup (DataAnnotations + ValidateOnStart), the
/// Zod-env-gate analog: an out-of-range retry knob or a blank cron fails FAST at boot rather than at the
/// first job fire. Valid defaults bind cleanly.
/// </summary>
public sealed class WorkerOptionsValidationTests
{
    [Fact]
    public void Valid_defaults_bind()
    {
        using var provider = BuildProvider([]);

        var options = provider.GetRequiredService<IOptions<WorkerOptions>>().Value;

        Assert.Equal("0 0 * * * ?", options.HrisSyncCron);
        Assert.True(options.HrisSyncEnabled);
        Assert.Equal(3, options.JobMaxAttempts);
        Assert.Equal(500, options.JobBaseRetryDelayMilliseconds);
        // Phase-4 Slice-2: clustering is OFF by default (RAMJobStore, single replica) with sane check-in knobs.
        Assert.False(options.ClusteredSchedulerEnabled);
        Assert.Equal(10, options.SchedulerCheckinIntervalSeconds);
        Assert.Equal(20, options.SchedulerCheckinMisfireThresholdSeconds);
    }

    [Fact]
    public void Blank_cron_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            ["Workers:HrisSyncCron"] = string.Empty,
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<WorkerOptions>>().Value);
    }

    [Fact]
    public void Out_of_range_max_attempts_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            // JobMaxAttempts is [Range(1, 10)] — 99 must fail fast.
            ["Workers:JobMaxAttempts"] = "99",
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<WorkerOptions>>().Value);
    }

    [Fact]
    public void Negative_retry_delay_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            // JobBaseRetryDelayMilliseconds is [Range(0, 600000)] — negative must fail fast.
            ["Workers:JobBaseRetryDelayMilliseconds"] = "-1",
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<WorkerOptions>>().Value);
    }

    [Fact]
    public void Out_of_range_checkin_interval_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            // SchedulerCheckinIntervalSeconds is [Range(1, 300)] — 0 must fail fast.
            ["Workers:SchedulerCheckinIntervalSeconds"] = "0",
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<WorkerOptions>>().Value);
    }

    [Fact]
    public void Out_of_range_checkin_misfire_threshold_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            // SchedulerCheckinMisfireThresholdSeconds is [Range(1, 600)] — 601 must fail fast.
            ["Workers:SchedulerCheckinMisfireThresholdSeconds"] = "601",
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<WorkerOptions>>().Value);
    }

    [Fact]
    public void Clustered_with_threshold_not_exceeding_interval_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            // Clustered + threshold (20) <= interval (60) → a healthy node one interval stale gets falsely
            // reclaimed. The IValidatableObject cross-field rule must fail this FAST.
            ["Workers:ClusteredSchedulerEnabled"] = "true",
            ["Workers:SchedulerCheckinIntervalSeconds"] = "60",
            ["Workers:SchedulerCheckinMisfireThresholdSeconds"] = "20",
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<WorkerOptions>>().Value);
    }

    [Fact]
    public void Clustered_with_threshold_above_interval_is_valid()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            ["Workers:ClusteredSchedulerEnabled"] = "true",
            ["Workers:SchedulerCheckinIntervalSeconds"] = "10",
            ["Workers:SchedulerCheckinMisfireThresholdSeconds"] = "30",
        });

        var options = provider.GetRequiredService<IOptions<WorkerOptions>>().Value;
        Assert.True(options.ClusteredSchedulerEnabled);
        Assert.Equal(30, options.SchedulerCheckinMisfireThresholdSeconds);
    }

    [Fact]
    public void Non_clustered_ignores_the_checkin_relationship()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            // The cross-field rule is clustered-only: with clustering off, the RAM path ignores both knobs,
            // so an "inverted" pair must NOT fail (it's inert).
            ["Workers:ClusteredSchedulerEnabled"] = "false",
            ["Workers:SchedulerCheckinIntervalSeconds"] = "60",
            ["Workers:SchedulerCheckinMisfireThresholdSeconds"] = "20",
        });

        var options = provider.GetRequiredService<IOptions<WorkerOptions>>().Value;
        Assert.False(options.ClusteredSchedulerEnabled);
    }

    private static ServiceProvider BuildProvider(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddOptions<WorkerOptions>()
            .Bind(configuration.GetSection(WorkerOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();
        return services.BuildServiceProvider();
    }
}
