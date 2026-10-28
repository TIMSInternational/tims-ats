using System.Diagnostics;
using Amazon.Runtime;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using Tims.Application.PlatformHealth;

namespace Tims.Infrastructure.PlatformHealth;

/// <summary>
/// S3 <c>HeadBucket</c> on the CV-upload bucket — the cheapest read S3 offers (no object listing, no data).
/// Needs <c>s3:ListBucket</c> on the bucket ARN for the instance role. Bucket or region unset ⇒
/// <c>not_configured</c>. The bucket name is never put on the wire or in a log.
/// </summary>
public sealed class CvBucketProbe(IOptions<PlatformHealthOptions> options, IAwsHealthClientFactory clients) : IDependencyProbe
{
    public string Id => DependencyIds.Storage;

    public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (!settings.HasCvBucket)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotConfigured, DependencyReason.MissingConfig);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            var s3 = clients.S3(settings.CvUploadsRegion!);
            await s3.HeadBucketAsync(new HeadBucketRequest { BucketName = settings.CvUploadsBucket }, cancellationToken)
                .ConfigureAwait(false);
            return DependencyProbeResult.Of(Id, DependencyStatus.Operational, null, stopwatch.ElapsedMilliseconds);
        }
        catch (AmazonServiceException ex) // AmazonS3Exception included; classified by status code only
        {
            return DependencyHealthClassifier.ClassifyBucketError((int)ex.StatusCode, stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.Unreachable, stopwatch.ElapsedMilliseconds);
        }
    }
}
