using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Tims.Api.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

public sealed class CvRecoveryRegistrationTests
{
    [Fact]
    public void Default_off_never_registers_a_claiming_worker_or_requires_aws_configuration()
    {
        var services = new ServiceCollection();
        var config = new ConfigurationBuilder().AddInMemoryCollection().Build();
        services.AddCvParseRecovery(config, "test-connection");
        Assert.DoesNotContain(services, descriptor => descriptor.ServiceType == typeof(IHostedService));
    }

    [Fact]
    public void Enabled_without_guardrail_fails_during_registration()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Platform:CvParseRecoveryEnabled"] = "true",
            ["CV_UPLOADS_BUCKET"] = "test-bucket",
            ["CV_UPLOADS_REGION"] = "us-east-2"
        }).Build();
        Assert.Throws<InvalidOperationException>(() =>
            new ServiceCollection().AddCvParseRecovery(config, "test-connection"));
    }

    private static Dictionary<string, string?> Complete() => new()
    {
        ["Platform:CvParseRecoveryEnabled"] = "true",
        ["CV_UPLOADS_BUCKET"] = "test-bucket",
        ["CV_UPLOADS_REGION"] = "us-east-2",
        ["BEDROCK_AWS_REGION"] = "us-east-2",
        ["BEDROCK_GUARDRAIL_ID"] = "test-guardrail",
        ["BEDROCK_GUARDRAIL_VERSION"] = "1"
    };

    [Theory]
    [InlineData("DRAFT")]
    [InlineData("draft")]
    [InlineData("0")]
    [InlineData("v1")]
    public void Draft_or_unpublished_guardrail_version_fails_registration(string version)
    {
        var values = Complete();
        values["BEDROCK_GUARDRAIL_VERSION"] = version;
        var config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var error = Assert.Throws<InvalidOperationException>(() =>
            new ServiceCollection().AddCvParseRecovery(config, "Host=localhost;Database=test"));
        Assert.Contains("published", error.Message);
    }

    [Fact]
    public void Activation_cutoff_defaults_to_host_start_minus_window_and_accepts_an_explicit_past_time()
    {
        var started = new DateTime(2026, 10, 12, 12, 0, 0, DateTimeKind.Utc);
        var empty = new ConfigurationBuilder().AddInMemoryCollection().Build();
        Assert.Equal(started - CvRecoveryServiceCollectionExtensions.DefaultActivationWindow,
            CvRecoveryServiceCollectionExtensions.CreatedAfter(empty, started));

        var explicitCutoff = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CV_RECOVERY_CREATED_AFTER"] = "2026-10-12T09:30:00Z"
        }).Build();
        var cutoff = CvRecoveryServiceCollectionExtensions.CreatedAfter(explicitCutoff, started);
        Assert.Equal(new DateTime(2026, 10, 12, 9, 30, 0, DateTimeKind.Utc), cutoff);
        Assert.Equal(DateTimeKind.Utc, cutoff.Kind);
    }

    [Theory]
    [InlineData("not-a-date")]
    [InlineData("2026-10-13T00:00:00Z")] // after host start: would silently disable recovery
    public void Invalid_or_future_cutoff_fails_registration(string value)
    {
        var values = Complete();
        values["CV_RECOVERY_CREATED_AFTER"] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        Assert.Throws<InvalidOperationException>(() => new ServiceCollection().AddCvParseRecovery(config,
            "Host=localhost;Database=test", new DateTime(2026, 10, 12, 12, 0, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void Complete_configuration_registers_exactly_one_worker()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Platform:CvParseRecoveryEnabled"] = "true",
            ["CV_UPLOADS_BUCKET"] = "test-bucket",
            ["CV_UPLOADS_REGION"] = "us-east-2",
            ["BEDROCK_AWS_REGION"] = "us-east-2",
            ["BEDROCK_GUARDRAIL_ID"] = "test-guardrail",
            ["BEDROCK_GUARDRAIL_VERSION"] = "1"
        }).Build();
        var services = new ServiceCollection();
        services.AddCvParseRecovery(config, "Host=localhost;Database=test;Username=test;Password=test");
        Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IHostedService));
        Assert.Single(services, descriptor => descriptor.ServiceType == typeof(Tims.Infrastructure.CvParsing.ICvTextExtractor));
    }
}
