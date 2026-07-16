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
