using System.Text.RegularExpressions;

namespace Tims.Infrastructure.PlatformHealth;

/// <summary>
/// Bound from the <c>PlatformHealth</c> section. Every value is a non-secret identifier; an unset value makes
/// its probe report <c>not_configured</c> instead of failing startup. The identifiers are used ONLY to make the
/// call — they are never echoed on the wire.
///
/// <para>The CV bucket and the Bedrock guardrail are configured in the web app as <c>CV_UPLOADS_BUCKET</c> /
/// <c>CV_UPLOADS_REGION</c> and <c>BEDROCK_GUARDRAIL_ID</c> / <c>BEDROCK_GUARDRAIL_VERSION</c>; set the same
/// values here (<c>PlatformHealth__CvUploadsBucket</c> …) so the probe checks the resource the app actually
/// uses.</para>
/// </summary>
public sealed partial class PlatformHealthOptions
{
    public const string SectionName = "PlatformHealth";

    public string? CvUploadsBucket { get; init; }

    public string? CvUploadsRegion { get; init; }

    public string? BedrockGuardrailId { get; init; }

    public string? BedrockGuardrailVersion { get; init; }

    public string? BedrockRegion { get; init; }

    /// <summary>Per-probe hard deadline. Default 2000ms.</summary>
    public int ProbeTimeoutMilliseconds { get; init; } = 2000;

    /// <summary>How long one probe round is reused. Default 30s; 30–60 accepted.</summary>
    public int CacheSeconds { get; init; } = 30;

    public bool IsValid() =>
        ProbeTimeoutMilliseconds is >= 250 and <= 5000
        && CacheSeconds is >= 30 and <= 60
        && (string.IsNullOrWhiteSpace(CvUploadsBucket) || BucketName().IsMatch(CvUploadsBucket))
        && (string.IsNullOrWhiteSpace(CvUploadsRegion) || IsRegion(CvUploadsRegion))
        && (string.IsNullOrWhiteSpace(BedrockRegion) || IsRegion(BedrockRegion))
        && (string.IsNullOrWhiteSpace(BedrockGuardrailId) || GuardrailIdentifier().IsMatch(BedrockGuardrailId))
        && (string.IsNullOrWhiteSpace(BedrockGuardrailVersion) || GuardrailVersion().IsMatch(BedrockGuardrailVersion));

    /// <summary>Both the bucket and its own region are required — no fallback (mirrors the web app's s3.ts rule).</summary>
    public bool HasCvBucket => !string.IsNullOrWhiteSpace(CvUploadsBucket) && !string.IsNullOrWhiteSpace(CvUploadsRegion);

    public bool HasGuardrail => !string.IsNullOrWhiteSpace(BedrockGuardrailId) && !string.IsNullOrWhiteSpace(BedrockRegion);

    internal static bool IsRegion(string value) =>
        Amazon.RegionEndpoint.EnumerableAllRegions.Any(region => region.SystemName == value);

    [GeneratedRegex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")]
    private static partial Regex BucketName();

    // A guardrail id (lowercase alphanumerics) or its full ARN.
    [GeneratedRegex("^(?:[a-z0-9]{1,64}|arn:aws(?:-[a-z]+)*:bedrock:[a-z0-9-]{1,20}:[0-9]{12}:guardrail/[a-z0-9]{1,64})$")]
    private static partial Regex GuardrailIdentifier();

    [GeneratedRegex("^(?:DRAFT|[1-9][0-9]{0,7})$")]
    private static partial Regex GuardrailVersion();
}
