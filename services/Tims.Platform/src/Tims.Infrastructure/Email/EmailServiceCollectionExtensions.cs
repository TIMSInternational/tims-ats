using Amazon;
using Amazon.Runtime;
using Amazon.SimpleEmail;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Tims.Application.Email;

namespace Tims.Infrastructure.Email;

public static class EmailServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformEmail(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<EmailOptions>()
            .Bind(configuration.GetSection(EmailOptions.SectionName))
            .Validate(options => options.IsValid(), "Email requires a valid region, plain sender mailbox and 1–60 second timeout")
            .ValidateOnStart();

        services.TryAddSingleton<IAmazonSimpleEmailService>(provider =>
        {
            var options = provider.GetRequiredService<IOptions<EmailOptions>>().Value;
            // Default AWS credentials chain: use the workload role, never config-file access keys.
            return new AmazonSimpleEmailServiceClient(CreateClientConfig(options));
        });
        services.AddSingleton(provider => new Lazy<IAmazonSimpleEmailService>(
            // The DI singleton serializes construction and owns disposal. PublicationOnly avoids
            // caching a transient constructor failure forever; a later request may initialize it.
            () => provider.GetRequiredService<IAmazonSimpleEmailService>(), LazyThreadSafetyMode.PublicationOnly));
        services.AddSingleton<SesEmailSender>();
        services.AddSingleton<IEmailSender>(provider =>
            provider.GetRequiredService<IOptions<EmailOptions>>().Value.Enabled
                ? provider.GetRequiredService<SesEmailSender>()
                : new DisabledEmailSender());
        return services;
    }

    internal static AmazonSimpleEmailServiceConfig CreateClientConfig(EmailOptions options) => new()
    {
        RegionEndpoint = RegionEndpoint.GetBySystemName(options.Region),
        RetryMode = RequestRetryMode.Standard,
        MaxErrorRetry = 0,
        // These are a separate SDK retry allowance and default to ten even with MaxErrorRetry=0.
        MaxStaleConnectionRetries = 0,
        Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds),
        LogResponse = false,
        LogMetrics = false,
    };
}
