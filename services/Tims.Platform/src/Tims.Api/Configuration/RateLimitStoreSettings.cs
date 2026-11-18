using System.Text.RegularExpressions;

namespace Tims.Api.Configuration;

/// <summary>
/// Reads and validates the shared rate-limit store settings, mirroring the TS <c>readSharedStoreConfig</c>:
/// both absent → no store; one without the other, or a malformed value → throw at startup (a typo would
/// otherwise fail every request instead of the deploy).
/// </summary>
public sealed partial record RateLimitStoreSettings(string Table, string Region)
{
    /// <summary>Startup error when neither setting is present outside Development (Program.cs).</summary>
    public const string MissingOutsideDevelopment =
        "The shared rate-limit store is required outside Development: set Platform__RateLimitDynamoDbTable and Platform__RateLimitDynamoDbRegion";

    public static RateLimitStoreSettings? Read(IConfiguration platformSection)
    {
        var table = platformSection[nameof(PlatformOptions.RateLimitDynamoDbTable)] ?? string.Empty;
        var region = platformSection[nameof(PlatformOptions.RateLimitDynamoDbRegion)] ?? string.Empty;
        if (table.Length == 0 && region.Length == 0)
        {
            return null;
        }

        if (table.Length == 0 || region.Length == 0)
        {
            throw new InvalidOperationException(
                "Rate limiting requires both Platform:RateLimitDynamoDbTable and Platform:RateLimitDynamoDbRegion");
        }

        if (!TableName().IsMatch(table))
        {
            throw new InvalidOperationException("Platform:RateLimitDynamoDbTable is not a valid DynamoDB table name");
        }

        if (!RegionName().IsMatch(region))
        {
            throw new InvalidOperationException("Platform:RateLimitDynamoDbRegion is not a valid AWS region");
        }

        return new RateLimitStoreSettings(table, region);
    }

    // Same patterns as the TS store (packages/api/src/middleware/rate-limit-store.ts).
    [GeneratedRegex("^[A-Za-z0-9_.-]{3,255}$")]
    private static partial Regex TableName();

    [GeneratedRegex("^[a-z]{2}(-[a-z]+)+-\\d$")]
    private static partial Regex RegionName();
}
