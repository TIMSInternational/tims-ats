using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Tims.Infrastructure.Hris;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// WP3.2 — <see cref="HrisOptions"/> validates at startup (DataAnnotations + ValidateOnStart), the
/// Zod-env-gate analog: an out-of-range knob or a missing required reference fails FAST rather than at
/// first BambooHR call.
/// </summary>
public sealed class HrisOptionsValidationTests
{
    [Fact]
    public void Valid_configuration_binds_and_resolves()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            ["Hris:BambooHrSubdomain"] = "acme",
            ["Hris:BambooHrSecretRef"] = "bamboohr/api-key",
        });

        var options = provider.GetRequiredService<IOptions<HrisOptions>>().Value;

        Assert.Equal("acme", options.BambooHrSubdomain);
        Assert.EndsWith("/", options.ResolvedBambooHrBaseUrl());
    }

    [Fact]
    public void Out_of_range_retry_count_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            // MaxRetryAttempts is [Range(0, 10)] — 99 must fail fast.
            ["Hris:MaxRetryAttempts"] = "99",
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<HrisOptions>>().Value);
    }

    [Fact]
    public void Blank_required_secret_ref_fails_validation()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            ["Hris:BambooHrSecretRef"] = string.Empty,
        });

        Assert.Throws<OptionsValidationException>(
            () => provider.GetRequiredService<IOptions<HrisOptions>>().Value);
    }

    private static ServiceProvider BuildProvider(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddOptions<HrisOptions>()
            .Bind(configuration.GetSection(HrisOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();
        return services.BuildServiceProvider();
    }
}
