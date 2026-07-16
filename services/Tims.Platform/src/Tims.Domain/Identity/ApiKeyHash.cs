using System.Security.Cryptography;
using System.Text;

namespace Tims.Domain.Identity;

/// <summary>
/// Ported 1:1 from packages/api/src/lib/api-key.ts (<c>hashApiKey</c>). The SINGLE source of
/// truth for the API-key hash: a lowercase SHA-256 HEX digest of the raw token's UTF-8 bytes.
/// Both the store (create) and the verify path hash through here so the two can never drift.
/// Raw keys are high-entropy random tokens, so a fast hash is appropriate (nothing to brute-force).
/// </summary>
public static class ApiKeyHash
{
    public static string Sha256Hex(string raw)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexStringLower(digest);
    }
}
