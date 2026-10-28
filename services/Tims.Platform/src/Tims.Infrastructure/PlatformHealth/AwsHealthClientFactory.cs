using System.Collections.Concurrent;
using Amazon;
using Amazon.Bedrock;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.Extensions.Options;

namespace Tims.Infrastructure.PlatformHealth;

/// <summary>Region-keyed AWS clients for the health probes. A seam so tests never reach AWS.</summary>
public interface IAwsHealthClientFactory
{
    IAmazonS3 S3(string region);

    IAmazonBedrock Bedrock(string region);
}

/// <summary>
/// Builds (and reuses, one per region) probe clients on the DEFAULT credential chain — the App Runner
/// instance role in production, never config-file keys. No SDK retries: a probe reports what one attempt saw
/// within its deadline, and retries would only push it past that deadline.
/// </summary>
public sealed class AwsHealthClientFactory(IOptions<PlatformHealthOptions> options) : IAwsHealthClientFactory, IDisposable
{
    private readonly ConcurrentDictionary<string, IAmazonS3> _s3 = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, IAmazonBedrock> _bedrock = new(StringComparer.Ordinal);

    public IAmazonS3 S3(string region) => _s3.GetOrAdd(region, r => new AmazonS3Client(Configure(new AmazonS3Config(), r)));

    public IAmazonBedrock Bedrock(string region) =>
        _bedrock.GetOrAdd(region, r => new AmazonBedrockClient(Configure(new AmazonBedrockConfig(), r)));

    private T Configure<T>(T config, string region) where T : ClientConfig
    {
        config.RegionEndpoint = RegionEndpoint.GetBySystemName(region);
        config.RetryMode = RequestRetryMode.Standard;
        config.MaxErrorRetry = 0;
        config.MaxStaleConnectionRetries = 0;
        config.Timeout = TimeSpan.FromMilliseconds(options.Value.ProbeTimeoutMilliseconds);
        config.LogResponse = false;
        config.LogMetrics = false;
        return config;
    }

    public void Dispose()
    {
        foreach (var client in _s3.Values)
        {
            client.Dispose();
        }

        foreach (var client in _bedrock.Values)
        {
            client.Dispose();
        }
    }
}
