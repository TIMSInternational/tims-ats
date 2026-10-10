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
    }
}
