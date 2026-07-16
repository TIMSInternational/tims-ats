using System.Text.RegularExpressions;

namespace Tims.Domain.Identity;

/// <summary>
/// Ported 1:1 from packages/api/src/lib/api-key.ts (<c>extractBearerToken</c>). Extracts a bearer
/// token from an Authorization header value. Scheme is case-insensitive. Returns null for any
/// missing/malformed/empty value — callers MUST treat null as "no credential" and FAIL CLOSED.
/// The token is read ONLY from the header, never from request input.
/// </summary>
public static partial class BearerToken
{
    // Defense-in-depth: reject absurdly long headers before hashing/DB lookup. A real key
    // (`tims_<env>_<64-hex>`) is well under 100 chars; 2048 is a generous ceiling. The check
    // runs on the RAW value (pre-trim), matching the TS length guard.
    private const int MaxHeaderLength = 2048;

    public static string? ExtractBearerToken(string? authorizationHeaderValue)
    {
        if (authorizationHeaderValue is null || authorizationHeaderValue.Length > MaxHeaderLength)
        {
            return null;
        }

        var match = BearerRegex().Match(authorizationHeaderValue.Trim());
        if (!match.Success)
        {
            return null;
        }

        var token = match.Groups[1].Value.Trim();
        return token.Length > 0 ? token : null;
    }

    [GeneratedRegex(@"^bearer\s+(.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex BearerRegex();
}
