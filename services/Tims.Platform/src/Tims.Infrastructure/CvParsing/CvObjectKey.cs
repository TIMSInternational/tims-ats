using System.Text.RegularExpressions;

namespace Tims.Infrastructure.CvParsing;

/// <summary>
/// The only CV object key shape the recovery loop will touch: exactly what the
/// portal's presigned upload generates (<c>packages/api/src/lib/s3.ts</c>,
/// <c>cv-uploads/{organizationId}/{randomUUID()}.{pdf|docx}</c>). A prefix check
/// alone accepted any client-supplied key under the tenant prefix (extra path
/// segments, other extensions, other naming); this requires one generated,
/// lowercase UUID file name directly under this organization's prefix.
/// The same rule is enforced in SQL (claim/stats) and before any S3 call.
/// </summary>
public static class CvObjectKey
{
    public const int MaxLength = 500;

    /// <summary>POSIX regex appended to <c>'^cv-uploads/' || organization_id::text</c> in SQL.</summary>
    public const string SqlSuffixPattern =
        "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pdf|docx)$";

    private static readonly Regex FileName = new(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:pdf|docx)\\z",
        RegexOptions.Compiled | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    public static bool IsValid(Guid organizationId, string? objectKey)
    {
        if (organizationId == Guid.Empty || string.IsNullOrEmpty(objectKey) || objectKey.Length > MaxLength)
            return false;
        var prefix = $"cv-uploads/{organizationId:D}/";
        return objectKey.StartsWith(prefix, StringComparison.Ordinal) &&
            FileName.IsMatch(objectKey.AsSpan(prefix.Length).ToString());
    }
}
